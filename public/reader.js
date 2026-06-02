// Reader (parent) page.
//
// Pushes three tracks to the SFU: the book (screen share), your face (camera),
// and your voice (mic). Then pulls each kid's camera + mic so you can see and
// hear their reactions.

import { SFUClient } from './sfu.js'
import { connectRoom } from './room-client.js'

const params = new URLSearchParams(location.search)
const room = params.get('room') || 'storytime'
const myId = crypto.randomUUID()

const overlay = document.getElementById('overlay')
const startBtn = document.getElementById('start')
const selfcam = document.getElementById('selfcam')
const kids = document.getElementById('kids')
const linkInput = document.getElementById('viewerlink')
const copyBtn = document.getElementById('copy')
const status = document.getElementById('status')

const sfu = new SFUClient()
const pulledViewers = new Set() // participant ids we've already pulled
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
		const stream = new MediaStream()
		el.srcObject = stream
		kids.appendChild(el)
		entry = { el, stream }
		kidStreams.set(info.participantId, entry)
	}
	entry.stream.addTrack(track)
}

startBtn.onclick = async () => {
	startBtn.disabled = true
	try {
		// Webcam + mic first, then the book window/tab.
		const camMic = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
		selfcam.srcObject = camMic
		const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })

		status.textContent = 'Connecting…'
		await sfu.createSession()
		await sfu.pushTracks([
			{ track: display.getVideoTracks()[0], name: 'screen' },
			{ track: camMic.getVideoTracks()[0], name: 'cam' },
			{ track: camMic.getAudioTracks()[0], name: 'mic' },
		])

		connectRoom(
			room,
			{ id: myId, role: 'reader', name: 'Reader', sessionId: sfu.sessionId, tracks: ['screen', 'cam', 'mic'] },
			{
				onRoster: (participants) => {
					const viewers = participants.filter((p) => p.role === 'viewer' && p.id !== myId)
					for (const v of viewers) {
						if (pulledViewers.has(v.id)) continue
						pulledViewers.add(v.id)
						sfu.pullTracks(v.id, v.sessionId, ['cam', 'mic']).catch((err) => {
							console.error('pull viewer failed', err)
							pulledViewers.delete(v.id)
						})
					}
					status.textContent = viewers.length
						? `${viewers.length} kid${viewers.length > 1 ? 's' : ''} connected.`
						: 'Waiting for kids to join…'
				},
			}
		)

		overlay.style.display = 'none'
		const viewerUrl = `${location.origin}/viewer?room=${encodeURIComponent(room)}`
		linkInput.value = viewerUrl
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
