// Viewer (kid) page.
//
// Pushes the kid's front camera + mic so the reader can see/hear them, then
// pulls whatever the reader publishes. The "book" comes in one of two ways:
//   - screen-share mode: the reader publishes a 'screen' video track -> <video>
//   - book-file mode:    the reader sends 'page' messages with images -> <img>
// Either way the reader's face is a corner PiP and their voice plays via <audio>.

import { SFUClient } from './sfu.js'
import { connectRoom } from './room-client.js'

const params = new URLSearchParams(location.search)
const room = params.get('room') || 'storytime'
const myId = crypto.randomUUID()

const overlay = document.getElementById('overlay')
const startBtn = document.getElementById('start')
const book = document.getElementById('book') // screen-share video
const bookpage = document.getElementById('bookpage') // synced page image
const readerface = document.getElementById('readerface')
const readeraudio = document.getElementById('readeraudio')
const soundBtn = document.getElementById('soundbtn')

const sfu = new SFUClient()
const overlaySub = overlay.querySelector('.sub')
sfu.onStatus = (m) => {
	if (overlaySub) overlaySub.textContent = m
}
let currentReaderId = null // id of the reader session we're currently pulling

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
			{
				onRoster: (participants) => {
					const reader = participants.find((p) => p.role === 'reader')
					if (!reader) {
						// Reader left (e.g. reloading). Forget them so we re-pull when
						// they come back; keep the last frame on screen meanwhile.
						currentReaderId = null
						return
					}
					if (reader.id !== currentReaderId) {
						// New or reloaded reader — switch to their fresh session.
						currentReaderId = reader.id
						resetReaderMedia()
						const names = (reader.tracks || []).filter((n) => ['screen', 'cam', 'mic'].includes(n))
						sfu.pullTracks(reader.id, reader.sessionId, names).catch((err) => {
							console.error('pull reader failed', err)
							currentReaderId = null // allow a retry on the next roster update
						})
					}
				},
				onMessage: (msg) => {
					if (msg.type === 'page' && msg.dataUrl) {
						bookpage.src = msg.dataUrl
						showPageBook()
					}
				},
			}
		)

		overlay.style.display = 'none'
	} catch (err) {
		console.error(err)
		overlay.querySelector('.sub').textContent = 'Error: ' + err.message
		startBtn.disabled = false
	}
}
