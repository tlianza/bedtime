// connectRoom — opens the signaling WebSocket to our Worker / Room Durable
// Object, announces who we are, and calls onRoster whenever the participant
// list changes. Auto-reconnects with a short backoff.
//
//   me = { id, role, name, sessionId, tracks }
//   onRoster(participants)  // participants: [{ id, role, name, sessionId, tracks }]

export function connectRoom(roomId, me, onRoster) {
	const proto = location.protocol === 'https:' ? 'wss' : 'ws'
	const url = `${proto}://${location.host}/api/room/${encodeURIComponent(roomId)}`
	let ws
	let closed = false

	const open = () => {
		ws = new WebSocket(url)
		ws.addEventListener('open', () => {
			ws.send(JSON.stringify({ type: 'join', ...me }))
		})
		ws.addEventListener('message', (event) => {
			let msg
			try {
				msg = JSON.parse(event.data)
			} catch {
				return
			}
			if (msg.type === 'roster') onRoster(msg.participants)
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
	}
}
