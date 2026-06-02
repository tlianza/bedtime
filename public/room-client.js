// connectRoom — opens the signaling WebSocket to our Worker / Room Durable
// Object, announces who we are, and delivers messages. Auto-reconnects.
//
//   me = { id, role, name, sessionId, tracks }
//   handlers = {
//     onRoster(participants),   // participant list changed
//     onMessage(msg),           // any non-roster message (e.g. page turns)
//   }
//
// Returns { close(), send(obj) }. send() buffers until the socket is open.

export function connectRoom(roomId, me, handlers = {}) {
	const { onRoster, onMessage } = handlers
	const proto = location.protocol === 'https:' ? 'wss' : 'ws'
	const url = `${proto}://${location.host}/api/room/${encodeURIComponent(roomId)}`
	let ws
	let closed = false
	const queue = []

	const flush = () => {
		while (queue.length && ws.readyState === WebSocket.OPEN) ws.send(queue.shift())
	}

	const open = () => {
		ws = new WebSocket(url)
		ws.addEventListener('open', () => {
			ws.send(JSON.stringify({ type: 'join', ...me }))
			flush()
		})
		ws.addEventListener('message', (event) => {
			let msg
			try {
				msg = JSON.parse(event.data)
			} catch {
				return
			}
			if (msg.type === 'roster') onRoster && onRoster(msg.participants)
			else onMessage && onMessage(msg)
		})
		ws.addEventListener('close', () => {
			if (!closed) setTimeout(open, 1000)
		})
	}
	open()

	return {
		close() {
			closed = true
			if (ws) ws.close()
		},
		send(obj) {
			const data = JSON.stringify(obj)
			if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
			else queue.push(data)
		},
	}
}
