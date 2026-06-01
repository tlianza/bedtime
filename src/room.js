// Room — a Durable Object that coordinates one bedtime "room".
//
// It does not touch media at all. Its only job is signaling: each connected
// client sends a "join" message describing its SFU session id and which track
// names it is publishing (e.g. reader -> ["screen","cam","mic"]). The Room
// keeps the live roster and broadcasts it to everyone whenever it changes, so
// each client knows which remote tracks to pull from the SFU.

export class Room {
	constructor(state, env) {
		this.state = state
		this.env = env
		// Map<WebSocket, participant>
		this.peers = new Map()
	}

	async fetch(request) {
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('expected websocket', { status: 426 })
		}

		const pair = new WebSocketPair()
		const client = pair[0]
		const server = pair[1]
		server.accept()

		server.addEventListener('message', (event) => {
			let msg
			try {
				msg = JSON.parse(event.data)
			} catch {
				return
			}
			if (msg.type === 'join') {
				this.peers.set(server, {
					id: msg.id,
					role: msg.role, // 'reader' | 'viewer'
					name: msg.name || (msg.role === 'reader' ? 'Reader' : 'Kid'),
					sessionId: msg.sessionId,
					tracks: msg.tracks || [],
				})
				this.broadcastRoster()
			}
		})

		const drop = () => {
			if (this.peers.delete(server)) this.broadcastRoster()
		}
		server.addEventListener('close', drop)
		server.addEventListener('error', drop)

		return new Response(null, { status: 101, webSocket: client })
	}

	broadcastRoster() {
		const participants = [...this.peers.values()]
		const payload = JSON.stringify({ type: 'roster', participants })
		for (const ws of this.peers.keys()) {
			try {
				ws.send(payload)
			} catch {
				// ignore broken sockets; their close handler will clean up
			}
		}
	}
}
