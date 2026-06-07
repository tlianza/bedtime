// connectRoom — opens the signaling WebSocket to our Worker / Room Durable
// Object, announces who we are, and delivers messages. Auto-reconnects.
//
//   me = { id, role, name, sessionId, tracks, secret }
//     secret is the room access token from the link fragment (#k=...). The Room
//     admits anyone into an empty room and seals it to that secret; a later
//     joiner without the matching secret is refused with a "denied" message.
//   handlers = {
//     onRoster(participants),   // participant list changed
//     onMessage(msg),           // any non-roster message (e.g. page turns)
//     onDenied(reason),         // room is in use and our secret didn't match
//   }
//
// Returns { close(), send(obj) }. send() buffers until the socket is open.

export function connectRoom(roomId, me, handlers = {}) {
	const { onRoster, onMessage, onDenied } = handlers
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
			if (msg.type === 'denied') {
				if (!closed) {
					closed = true // refused entry — don't reconnect into the same wall
					onDenied && onDenied(msg.reason)
				}
			} else if (msg.type === 'roster') onRoster && onRoster(msg.participants)
			else onMessage && onMessage(msg)
		})
		ws.addEventListener('close', (event) => {
			// 4001 = room refused us (in use). Don't reconnect into the same wall.
			if (event.code === 4001 && !closed) {
				closed = true
				onDenied && onDenied('room-in-use')
			}
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
