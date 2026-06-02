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

const sfu = new SFUClient()
const overlaySub = overlay.querySelector('.sub')
sfu.onStatus = (m) => {
	if (overlaySub) overlaySub.textContent = m
}
let pulledReader = false

book.srcObject = new MediaStream()
readerface.srcObject = new MediaStream()
readeraudio.srcObject = new MediaStream()

function showVideoBook() {
	bookpage.hidden = true
	book.hidden = false
	book.play().catch(() => {})
}
function showPageBook() {
	book.hidden = true
	bookpage.hidden = false
}

sfu.onRemoteTrack = (info, track) => {
	if (!info) return
	if (info.trackName === 'screen') {
		book.srcObject.addTrack(track)
		showVideoBook()
	} else if (info.trackName === 'cam') {
		readerface.srcObject.addTrack(track)
	} else if (info.trackName === 'mic') {
		readeraudio.srcObject.addTrack(track)
		readeraudio.play().catch(() => {})
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
					if (reader && !pulledReader) {
						pulledReader = true
						// Pull exactly the tracks the reader advertises (screen mode
						// has 'screen'; book-file mode has only 'cam' + 'mic').
						const names = (reader.tracks || []).filter((n) => ['screen', 'cam', 'mic'].includes(n))
						sfu.pullTracks(reader.id, reader.sessionId, names).catch((err) => {
							console.error('pull reader failed', err)
							pulledReader = false
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
