// Viewer (kid) page.
//
// Pushes the kid's front camera + mic so the reader can see/hear them, then
// pulls whatever the reader publishes. The "book" comes in one of two ways:
//   - screen-share mode: the reader publishes a 'screen' video track -> <video>
//   - book-file mode:    the reader sends 'page' messages with images -> <img>
// Either way the reader's face is a corner PiP and their voice plays via <audio>.

import { SFUClient } from './sfu.js'
import { connectRoom } from './room-client.js'
import { readRoomConfig } from './room.js'

const { room, secret } = readRoomConfig()

const overlay = document.getElementById('overlay')
const startBtn = document.getElementById('start')
const book = document.getElementById('book') // screen-share video
const bookpage = document.getElementById('bookpage') // synced page image
const readerface = document.getElementById('readerface')
const selfcam = document.getElementById('selfcam')
const readeraudio = document.getElementById('readeraudio')
const soundBtn = document.getElementById('soundbtn')
const netbanner = document.getElementById('netbanner')

const sfu = new SFUClient()
const overlaySub = overlay.querySelector('.sub')
sfu.onStatus = (m) => {
	if (overlaySub) overlaySub.textContent = m
}

// Identity stays stable across reconnects; only sessionId changes. room-client
// re-announces this object (by reference) whenever the signaling socket opens.
const me = { id: crypto.randomUUID(), role: 'viewer', name: 'Kid', sessionId: null, tracks: ['cam', 'mic'], secret }
let roomConn = null
let lastParticipants = []
let currentReaderSession = null // sessionId of the reader we're currently pulling

function showVideoBook() {
	bookpage.hidden = true
	book.hidden = false
	tryPlay(book)
}
function showPageBook() {
	book.hidden = true
	bookpage.hidden = false
}

// Drop the previous reader's (now-frozen) tracks before pulling a new reader.
function resetReaderMedia() {
	book.srcObject = new MediaStream()
	readerface.srcObject = new MediaStream()
	readeraudio.srcObject = new MediaStream()
}

// Try to play an element; if the browser blocks it (iOS autoplay policy),
// reveal the "Tap for sound" button so the kid can unblock with one tap.
function tryPlay(el) {
	if (!el.play) return
	const p = el.play()
	if (p && p.catch) p.catch(() => (soundBtn.hidden = false))
}

soundBtn.onclick = () => {
	// A fresh user gesture — retry every media element, then hide the button.
	;[readeraudio, book, readerface].forEach((el) => el.play && el.play().catch(() => {}))
	soundBtn.hidden = true
}

// Add a track to an element's stream and re-assign srcObject so Safari repaints.
function attach(el, track) {
	const s = el.srcObject instanceof MediaStream ? el.srcObject : new MediaStream()
	s.addTrack(track)
	el.srcObject = s
	tryPlay(el)
}

sfu.onRemoteTrack = (info, track) => {
	if (!info) return
	if (info.trackName === 'screen') {
		attach(book, track)
		showVideoBook()
	} else if (info.trackName === 'cam') {
		attach(readerface, track)
	} else if (info.trackName === 'mic') {
		attach(readeraudio, track)
	}
}

// Pull the reader's tracks whenever their session changes (new reader, reload,
// or their own reconnect — all of which produce a fresh sessionId).
function syncRoster(participants) {
	lastParticipants = participants
	const reader = participants.find((p) => p.role === 'reader')
	if (!reader) {
		currentReaderSession = null // re-pull when they return
		return
	}
	if (reader.sessionId !== currentReaderSession) {
		currentReaderSession = reader.sessionId
		resetReaderMedia()
		const names = (reader.tracks || []).filter((n) => ['screen', 'cam', 'mic'].includes(n))
		sfu.pullTracks(reader.id, reader.sessionId, names).catch((err) => {
			console.error('pull reader failed', err)
			currentReaderSession = null // allow a retry on the next roster update
		})
	}
}

sfu.onConnectionChange = (state) => {
	if (state === 'connected') netbanner.hidden = true
	else {
		netbanner.textContent = 'Reconnecting…'
		netbanner.hidden = false
	}
}

// After the SFU rebuilds our session, re-announce the new sessionId (so the
// reader re-pulls us) and re-pull the reader fresh.
sfu.onReconnected = (newSessionId) => {
	me.sessionId = newSessionId
	if (roomConn) roomConn.send({ type: 'join', ...me })
	currentReaderSession = null
	resetReaderMedia()
	syncRoster(lastParticipants)
}

startBtn.onclick = async () => {
	startBtn.disabled = true
	try {
		const camMic = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: 'user' },
			audio: true,
		})
		selfcam.srcObject = camMic // let the kid see themselves

		await sfu.createSession()
		await sfu.pushTracks([
			{ track: camMic.getVideoTracks()[0], name: 'cam' },
			{ track: camMic.getAudioTracks()[0], name: 'mic' },
		])

		me.sessionId = sfu.sessionId
		roomConn = connectRoom(room, me, {
			onRoster: syncRoster,
			onMessage: (msg) => {
				if (msg.type === 'page' && msg.dataUrl) {
					bookpage.src = msg.dataUrl
					showPageBook()
				}
			},
			onDenied: () => {
				overlay.style.display = 'flex'
				overlay.querySelector('.sub').textContent =
					'Someone is already watching in this room — ask a parent for the link they sent.'
			},
		})

		overlay.style.display = 'none'
	} catch (err) {
		console.error(err)
		overlay.querySelector('.sub').textContent = 'Error: ' + err.message
		startBtn.disabled = false
	}
}
