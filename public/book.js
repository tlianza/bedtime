// Reader (parent), book-file mode — iPad-friendly.
//
// The book lives IN the app: load a PDF (via pdf.js) or page images, render the
// current page to a canvas, and send that image to the kids over the room
// channel on every page turn. Your camera + mic stream via the SFU as usual;
// there is NO screen-share here, which is what makes this work on iPad.

import { SFUClient } from './sfu.js'
import { connectRoom } from './room-client.js'
import { readRoomConfig, viewerLink } from './room.js'

const { room, secret } = readRoomConfig()
const myId = crypto.randomUUID()

const overlay = document.getElementById('overlay')
const fileInput = document.getElementById('file')
const startBtn = document.getElementById('start')
const setupHint = document.getElementById('setup-hint')
const canvas = document.getElementById('page')
const ctx = canvas.getContext('2d')
const prevBtn = document.getElementById('prev')
const nextBtn = document.getElementById('next')
const pagenum = document.getElementById('pagenum')
const selfcam = document.getElementById('selfcam')
const kids = document.getElementById('kids')
const linkInput = document.getElementById('viewerlink')
const copyBtn = document.getElementById('copy')
const status = document.getElementById('status')
const netbanner = document.getElementById('netbanner')

const MAX_W = 1200 // cap rendered page width to keep the sent image small

// pdf.js needs its worker URL set explicitly, or parsing hangs/falls back to a
// slow main-thread path (worst on flaky connections).
if (window.pdfjsLib) {
	window.pdfjsLib.GlobalWorkerOptions.workerSrc =
		'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
}

// Show progress/errors on the overlay (the toolbar #status is hidden behind it).
function setupMsg(text) {
	setupHint.textContent = text
}

const sfu = new SFUClient()
sfu.onStatus = setupMsg // show connection progress on the overlay

const me = { id: crypto.randomUUID(), role: 'reader', name: 'Reader', sessionId: null, tracks: ['cam', 'mic'], secret }

// The room name is already in use by someone else right now (rare with
// auto-generated slugs; mainly a hand-picked name that collides).
function onRoomDenied() {
	setupMsg('That room is in use right now — go back and start a new one (leave the name blank to auto-generate).')
}
let roomConn = null
let lastParticipants = []
const pulledViewers = new Map() // participantId -> sessionId we're pulling
const kidStreams = new Map()

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
		if (pulledViewers.get(v.id) === v.sessionId) continue
		removeKid(v.id)
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

// Session rebuilt: re-announce, re-pull every kid, and re-send the current page.
sfu.onReconnected = (newSessionId) => {
	me.sessionId = newSessionId
	if (roomConn) roomConn.send({ type: 'join', ...me })
	for (const id of [...kidStreams.keys()]) removeKid(id)
	syncRoster(lastParticipants)
	if (pageCount > 0) sendPage()
}

// --- Book source: either a pdf.js document or a list of image URLs ---
let pdfDoc = null
let imageUrls = []
let pageCount = 0
let pageIndex = 1

fileInput.onchange = async () => {
	const files = [...fileInput.files]
	if (!files.length) return
	pdfDoc = null
	imageUrls = []
	startBtn.disabled = true
	try {
		if (files.length === 1 && files[0].type === 'application/pdf') {
			if (!window.pdfjsLib) {
				throw new Error('PDF library failed to load (check your connection). Try reloading, or use page images instead.')
			}
			setupMsg('Reading PDF…')
			const buf = await files[0].arrayBuffer()
			pdfDoc = await window.pdfjsLib.getDocument({ data: buf }).promise
			pageCount = pdfDoc.numPages
		} else {
			// Treat as image pages, sorted by filename for predictable order.
			imageUrls = files
				.filter((f) => f.type.startsWith('image/'))
				.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
				.map((f) => URL.createObjectURL(f))
			pageCount = imageUrls.length
		}
		if (pageCount > 0) {
			pageIndex = 1
			startBtn.disabled = false
			setupHint.textContent = `${pageCount} page${pageCount > 1 ? 's' : ''} loaded. Ready.`
		} else {
			setupHint.textContent = 'No readable pages found in that selection.'
		}
	} catch (err) {
		console.error(err)
		setupHint.textContent = 'Could not open that file: ' + err.message
	}
}

async function renderPage() {
	if (pdfDoc) {
		const page = await pdfDoc.getPage(pageIndex)
		const base = page.getViewport({ scale: 1 })
		const scale = Math.min(MAX_W / base.width, 2)
		const viewport = page.getViewport({ scale })
		canvas.width = viewport.width
		canvas.height = viewport.height
		await page.render({ canvasContext: ctx, viewport }).promise
	} else {
		const url = imageUrls[pageIndex - 1]
		const img = await loadImage(url)
		const scale = Math.min(MAX_W / img.width, 1)
		canvas.width = Math.round(img.width * scale)
		canvas.height = Math.round(img.height * scale)
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
	}
	pagenum.textContent = `${pageIndex} / ${pageCount}`
	sendPage()
}

function loadImage(url) {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => resolve(img)
		img.onerror = reject
		img.src = url
	})
}

function sendPage() {
	if (!roomConn) return
	const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
	roomConn.send({ type: 'page', dataUrl, index: pageIndex })
}

prevBtn.onclick = () => {
	if (pageIndex > 1) {
		pageIndex--
		renderPage()
	}
}
nextBtn.onclick = () => {
	if (pageIndex < pageCount) {
		pageIndex++
		renderPage()
	}
}

// Route incoming kid tracks to per-kid tiles (same as screen-share reader).
sfu.onRemoteTrack = (info, track) => {
	if (!info) return
	let entry = kidStreams.get(info.participantId)
	if (!entry) {
		const el = document.createElement('video')
		el.autoplay = true
		el.playsInline = true
		kids.appendChild(el)
		entry = { el, stream: new MediaStream() }
		kidStreams.set(info.participantId, entry)
	}
	entry.stream.addTrack(track)
	entry.el.srcObject = entry.stream // re-assign so Safari repaints
	entry.el.play().catch(() => {})
}

startBtn.onclick = async () => {
	startBtn.disabled = true
	try {
		setupMsg('Requesting camera & microphone…')
		const camMic = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: 'user' },
			audio: true,
		})
		selfcam.srcObject = camMic

		setupMsg('Connecting… (this can take a few seconds)')
		status.textContent = 'Connecting…'
		await sfu.createSession()
		await sfu.pushTracks([
			{ track: camMic.getVideoTracks()[0], name: 'cam' },
			{ track: camMic.getAudioTracks()[0], name: 'mic' },
		])

		me.sessionId = sfu.sessionId
		roomConn = connectRoom(room, me, { onRoster: syncRoster, onDenied: onRoomDenied })

		overlay.style.display = 'none'
		linkInput.value = viewerLink(location.origin, room, secret)
		await renderPage() // show + send the first page
	} catch (err) {
		console.error(err)
		setupMsg('Could not start: ' + err.message)
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
