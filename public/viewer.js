// Viewer (kid) page.
//
// Pushes the kid's front camera + mic so the reader can see/hear them, then
// pulls the reader's three tracks: the book (full screen), the reader's face
// (corner PiP), and the reader's voice (played through the book element).

import { SFUClient } from './sfu.js'
import { connectRoom } from './room-client.js'

const params = new URLSearchParams(location.search)
const room = params.get('room') || 'storytime'
const myId = crypto.randomUUID()

const overlay = document.getElementById('overlay')
const startBtn = document.getElementById('start')
const book = document.getElementById('book')
const readerface = document.getElementById('readerface')

const sfu = new SFUClient()
let pulledReader = false

// Ensure each element has a MediaStream we can add tracks to.
book.srcObject = new MediaStream()
readerface.srcObject = new MediaStream()

sfu.onRemoteTrack = (info, track) => {
	if (!info) return
	if (info.trackName === 'screen') {
		book.srcObject.addTrack(track) // the book pages
	} else if (info.trackName === 'cam') {
		readerface.srcObject.addTrack(track) // reader's face (PiP)
	} else if (info.trackName === 'mic') {
		book.srcObject.addTrack(track) // reader's voice -> plays via the (unmuted) book element
	}
	// Nudge playback; harmless if already playing.
	book.play().catch(() => {})
}

startBtn.onclick = async () => {
	startBtn.disabled = true
	try {
		const camMic = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: 'user' },
			audio: true,
		})

		await sfu.createSession()
		await sfu.pushTracks([
			{ track: camMic.getVideoTracks()[0], name: 'cam' },
			{ track: camMic.getAudioTracks()[0], name: 'mic' },
		])

		connectRoom(
			room,
			{ id: myId, role: 'viewer', name: 'Kid', sessionId: sfu.sessionId, tracks: ['cam', 'mic'] },
			(participants) => {
				const reader = participants.find((p) => p.role === 'reader')
				if (reader && !pulledReader) {
					pulledReader = true
					sfu.pullTracks(reader.id, reader.sessionId, ['screen', 'cam', 'mic']).catch((err) => {
						console.error('pull reader failed', err)
						pulledReader = false
					})
				}
			}
		)

		overlay.style.display = 'none'
	} catch (err) {
		console.error(err)
		overlay.querySelector('.sub').textContent = 'Error: ' + err.message
		startBtn.disabled = false
	}
}
