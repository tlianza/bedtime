// SFUClient — a tiny vanilla wrapper around the Cloudflare Realtime SFU.
//
// One client == one WebRTC PeerConnection == one SFU "session". You push your
// local tracks (camera/mic/screen) and pull remote tracks published by other
// sessions. All SFU API calls go through our Worker proxy (/api/sessions/*),
// which adds the App Secret server-side.
//
// API flow reference: https://developers.cloudflare.com/realtime/sfu/

export class SFUClient {
	constructor() {
		this.pc = null
		this.sessionId = null
		// Map<mid, {participantId, trackName}> so ontrack can route incoming media.
		this.midToTrack = new Map()
		// Called for each remote track that arrives: (info, MediaStreamTrack)
		this.onRemoteTrack = null
		// Called with human-readable progress strings during connection setup.
		this.onStatus = null
	}

	_status(msg) {
		if (this.onStatus) this.onStatus(msg)
	}

	async _api(path, method, body) {
		const res = await fetch('/api' + path, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: body ? JSON.stringify(body) : undefined,
		})
		const text = await res.text()
		if (!res.ok) throw new Error(`SFU ${method} ${path} -> ${res.status}: ${text}`)
		return text ? JSON.parse(text) : {}
	}

	async _fetchIceServers() {
		try {
			const res = await fetch('/api/turn')
			if (res.ok) {
				const data = await res.json()
				if (data.iceServers && data.iceServers.length) return data.iceServers
			}
		} catch {
			// fall through to STUN-only
		}
		return [{ urls: 'stun:stun.cloudflare.com:3478' }]
	}

	async createSession() {
		this._status('Finding the best network path…')
		const iceServers = await this._fetchIceServers()
		const hasRelay = iceServers.some((s) =>
			[].concat(s.urls).some((u) => u.startsWith('turn:') || u.startsWith('turns:'))
		)
		this._status(
			hasRelay
				? 'Network path ready — relay (TURN) available ✓'
				: 'Network path ready — direct/STUN only (no relay)'
		)

		this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })

		this.pc.addEventListener('track', (event) => {
			const mid = event.transceiver && event.transceiver.mid
			const info = this.midToTrack.get(mid)
			if (this.onRemoteTrack) this.onRemoteTrack(info, event.track)
		})

		this._status('Creating session…')
		const data = await this._api('/sessions/new', 'POST')
		this.sessionId = data.sessionId
	}

	// tracks: [{ track: MediaStreamTrack, name: string }]
	async pushTracks(tracks) {
		const transceivers = tracks.map((t) =>
			this.pc.addTransceiver(t.track, { direction: 'sendonly' })
		)
		await this.pc.setLocalDescription(await this.pc.createOffer())

		this._status('Negotiating audio/video…')
		const data = await this._api(`/sessions/${this.sessionId}/tracks/new`, 'POST', {
			sessionDescription: { type: 'offer', sdp: this.pc.localDescription.sdp },
			tracks: tracks.map((t, i) => ({
				location: 'local',
				mid: transceivers[i].mid,
				trackName: t.name,
			})),
		})

		await this.pc.setRemoteDescription(new RTCSessionDescription(data.sessionDescription))
		this._status('Establishing connection…')
		await this._waitConnected()
		this._status('Connected ✓')
	}

	// Pull one or more named tracks published by a remote session.
	async pullTracks(participantId, remoteSessionId, trackNames) {
		const data = await this._api(`/sessions/${this.sessionId}/tracks/new`, 'POST', {
			tracks: trackNames.map((name) => ({
				location: 'remote',
				sessionId: remoteSessionId,
				trackName: name,
			})),
		})

		// Record mid -> track info BEFORE applying the offer, so the 'track'
		// event (which fires during setRemoteDescription) can route correctly.
		for (const t of data.tracks || []) {
			if (t.mid != null) {
				this.midToTrack.set(String(t.mid), { participantId, trackName: t.trackName })
			}
		}

		if (data.requiresImmediateRenegotiation) {
			await this.pc.setRemoteDescription(new RTCSessionDescription(data.sessionDescription))
			await this.pc.setLocalDescription(await this.pc.createAnswer())
			await this._api(`/sessions/${this.sessionId}/renegotiate`, 'PUT', {
				sessionDescription: { type: 'answer', sdp: this.pc.localDescription.sdp },
			})
		}
	}

	_waitConnected() {
		if (this.pc.connectionState === 'connected') return Promise.resolve()
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				cleanup()
				reject(
					new Error(
						'connection timed out — your network may be blocking WebRTC. Turning on TURN relay usually fixes this.'
					)
				)
			}, 20000)
			const cleanup = () => {
				clearTimeout(timeout)
				this.pc.removeEventListener('connectionstatechange', report)
				this.pc.removeEventListener('iceconnectionstatechange', report)
			}
			const report = () => {
				// Surface the live ICE state so a stall is visible (e.g. stuck on
				// "checking" usually means NAT/firewall — TURN relay is the fix).
				this._status('Connecting… (' + this.pc.iceConnectionState + ')')
				const s = this.pc.connectionState
				if (s === 'connected') {
					cleanup()
					resolve()
				} else if (s === 'failed') {
					cleanup()
					reject(new Error('connection failed — network blocked WebRTC (TURN relay should help)'))
				}
			}
			this.pc.addEventListener('connectionstatechange', report)
			this.pc.addEventListener('iceconnectionstatechange', report)
		})
	}
}
