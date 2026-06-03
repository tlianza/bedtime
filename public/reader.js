// Reader (parent) page — screen-share mode.
//
// Pushes three tracks to the SFU: the book (screen share), your face (camera),
// and your voice (mic). Then pulls each kid's camera + mic so you can see and
// hear their reactions. Recovers automatically from reloads and network drops.

import { SFUClient } from './sfu.js'
import { connectRoom } from './room-client.js'

const params = new URLSearchParams(location.search)
const room = params.get('room') || 'storytime'

const overlay = document.getElementById('overlay')
const startBtn = document.getElementById('start')
const selfcam = document.getElementById('selfcam')
const kids = document.getElementById('kids')
const screenpreview = document.getElementById('screenpreview')
const shareTile = document.getElementById('share-tile')
const linkInput = document.getElementById('viewerlink')
const copyBtn = document.getElementById('copy')
const status = document.getElementById('status')
const netbanner = document.getElementById('netbanner')

const sfu = new SFUClient()
const overlaySub = overlay.querySelector('.sub')
sfu.onStatus = (m) => {
	if (overlaySub) overlaySub.textContent = m
}

const me = { id: crypto.randomUUID(), role: 'reader', name: 'Reader', sessionId: null, tracks: ['screen', 'cam', 'mic'] }
let roomConn = null
let lastParticipants = []
const pulledViewers = new Map() // participantId -> sessionId we're pulling
const kidStreams = new Map() // participantId -> { el, stream }

// Route incoming kid tracks to a per-kid <video> tile.
sfu.onRemoteTrack = (info, track) => {
	if (!info) return
	let entry = kidStreams.get(info.participantId)
	if (!entry) {
		const el = document.createElement('video')
		el.autoplay = true
		el.playsInline = true
		// not muted — we want to hear the kids
		kids.appendChild(el)
		entry = { el, stream: new MediaStream() }
		kidStreams.set(info.participantId, entry)
	}
	entry.stream.addTrack(track)
	entry.el.srcObject = entry.stream // re-assign so Safari repaints
	entry.el.play().catch(() => {})
}

function removeKid(id) {
	const entry = kidStreams.get(id)
	if (entry) entry.el.remove()
	kidStreams.delete(id)
	pulledViewers.delete(id)
}

// Pull each kid's tracks; re-pull when their sessionId changes (reload/reconnect).
function syncRoster(participants) {
	lastParticipants = participants
	const viewers = participants.filter((p) => p.role === 'viewer' && p.id !== me.id)
	const present = new Set(viewers.map((v) => v.id))
	for (const id of [...kidStreams.keys()]) if (!present.has(id)) removeKid(id)

	for (const v of viewers) {
		if (pulledViewers.get(v.id) === v.sessionId) continue // already pulling this session
		removeKid(v.id) // drop any stale tile/session before re-pulling
		pulledViewers.set(v.id, v.sessionId)
		sfu.pullTracks(v.id, v.sessionId, ['cam', 'mic']).catch((err) => {
			console.error('pull viewer failed', err)
			if (pulledViewers.get(v.id) === v.sessionId) pulledViewers.delete(v.id)
		})
	}
	status.textContent = viewers.length
		? `${viewers.length} kid${viewers.length > 1 ? 's' : ''} connected.`
		: 'Waiting for kids to join…'
}

sfu.onConnectionChange = (state) => {
	if (state === 'connected') netbanner.hidden = true
	else {
		netbanner.textContent = 'Reconnecting…'
		netbanner.hidden = false
	}
}

// Our session was rebuilt: re-announce, then re-pull every kid from scratch.
sfu.onReconnected = (newSessionId) => {
	me.sessionId = newSessionId
	if (roomConn) roomConn.send({ type: 'join', ...me })
	for (const id of [...kidStreams.keys()]) removeKid(id)
	syncRoster(lastParticipants)
}

startBtn.onclick = async () => {
	startBtn.disabled = true
	try {
		// Webcam + mic first, then the book window/tab.
		const camMic = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
		selfcam.srcObject = camMic
		const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
		// Show what you're sharing back to yourself so you can read along.
		screenpreview.srcObject = display
		shareTile.hidden = false
		// If you stop sharing (browser "Stop sharing" button), hide the preview.
		display.getVideoTracks()[0].addEventListener('ended', () => {
			shareTile.hidden = true
		})

		status.textContent = 'Connecting…'
		await sfu.createSession()
		await sfu.pushTracks([
			{ track: display.getVideoTracks()[0], name: 'screen' },
			{ track: camMic.getVideoTracks()[0], name: 'cam' },
			{ track: camMic.getAudioTracks()[0], name: 'mic' },
		])

		me.sessionId = sfu.sessionId
		roomConn = connectRoom(room, me, { onRoster: syncRoster })

		overlay.style.display = 'none'
		linkInput.value = `${location.origin}/viewer?room=${encodeURIComponent(room)}`
	} catch (err) {
		console.error(err)
		status.textContent = 'Error: ' + err.message
		startBtn.disabled = false
	}
}

copyBtn.onclick = async () => {
	if (!linkInput.value) return
	try {
		await navigator.clipboard.writeText(linkInput.value)
		copyBtn.textContent = 'Copied!'
		setTimeout(() => (copyBtn.textContent = 'Copy link'), 1500)
	} catch {
		linkInput.select()
	}
}
