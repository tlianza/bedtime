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
		this.pc = new RTCPeerConnection({
			iceServers: await this._fetchIceServers(),
			bundlePolicy: 'max-bundle',
		})

		this.pc.addEventListener('track', (event) => {
			const mid = event.transceiver && event.transceiver.mid
			const info = this.midToTrack.get(mid)
			if (this.onRemoteTrack) this.onRemoteTrack(info, event.track)
		})

		const data = await this._api('/sessions/new', 'POST')
		this.sessionId = data.sessionId
	}

	// tracks: [{ track: MediaStreamTrack, name: string }]
	async pushTracks(tracks) {
		const transceivers = tracks.map((t) =>
			this.pc.addTransceiver(t.track, { direction: 'sendonly' })
		)
		await this.pc.setLocalDescription(await this.pc.createOffer())

		const data = await this._api(`/sessions/${this.sessionId}/tracks/new`, 'POST', {
			sessionDescription: { type: 'offer', sdp: this.pc.localDescription.sdp },
			tracks: tracks.map((t, i) => ({
				location: 'local',
				mid: transceivers[i].mid,
				trackName: t.name,
			})),
		})

		await this.pc.setRemoteDescription(new RTCSessionDescription(data.sessionDescription))
		await this._waitConnected()
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
			const timeout = setTimeout(() => reject(new Error('WebRTC connection timed out')), 15000)
			const check = () => {
				const s = this.pc.connectionState
				if (s === 'connected') {
					clearTimeout(timeout)
					this.pc.removeEventListener('connectionstatechange', check)
					resolve()
				} else if (s === 'failed') {
					clearTimeout(timeout)
					reject(new Error('WebRTC connection failed'))
				}
			}
			this.pc.addEventListener('connectionstatechange', check)
		})
	}
}
