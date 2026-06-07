// Room — a Durable Object that coordinates one bedtime "room".
//
// It does not touch media at all. Two jobs:
//   1. Signaling: each client sends a "join" with its SFU session id and which
//      track names it publishes; the Room keeps the roster and broadcasts it so
//      everyone knows which remote tracks to pull.
//   2. Page sync (iPad / book-file mode): the reader sends "page" messages with
//      a rendered page image; the Room relays them to the kids and remembers the
//      latest so a kid who joins late immediately sees the current page.

export class Room {
	constructor(state, env) {
		this.state = state
		this.env = env
		this.peers = new Map() // Map<WebSocket, participant>
		this.currentPage = null // { dataUrl, index } — latest page the reader sent
		this.secret = null // access token; set by the first joiner, cleared when empty
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
				// Access control (login-free, trust-on-first-use):
				//   empty room        -> admit, and adopt this joiner's secret
				//   secret matches     -> admit (any role; e.g. a kid's 2nd device)
				//   no/wrong secret    -> admit only if this ROLE slot is still open
				//                         (so the first kid can join a freshly-started
				//                         room without the link), else refuse.
				// This keeps the usual "one reader + one viewer" open while blocking
				// a stranger from taking an already-filled seat.
				const provided = msg.secret || null
				if (this.peers.size === 0) {
					this.secret = provided
				} else if (provided !== this.secret) {
					const roleTaken = [...this.peers.values()].some((p) => p.role === msg.role)
					if (roleTaken) {
						this.sendTo(server, { type: 'denied', reason: 'role-taken' })
						try {
							server.close(4001, 'role-taken')
						} catch {
							// already gone
						}
						return
					}
				}
				this.peers.set(server, {
					id: msg.id,
					role: msg.role, // 'reader' | 'viewer'
					name: msg.name || (msg.role === 'reader' ? 'Reader' : 'Kid'),
					sessionId: msg.sessionId,
					tracks: msg.tracks || [],
				})
				this.broadcastRoster()
				// Catch a late-joining kid up to the page the reader is on.
				if (this.currentPage && msg.role === 'viewer') {
					this.sendTo(server, { type: 'page', ...this.currentPage })
				}
			} else if (msg.type === 'page') {
				this.currentPage = { dataUrl: msg.dataUrl, index: msg.index }
				this.broadcast({ type: 'page', dataUrl: msg.dataUrl, index: msg.index }, server)
			}
		})

		const drop = () => {
			if (this.peers.delete(server)) this.broadcastRoster()
			// Room emptied: forget the secret so the next arrival re-claims it.
			if (this.peers.size === 0) this.secret = null
		}
		server.addEventListener('close', drop)
		server.addEventListener('error', drop)

		return new Response(null, { status: 101, webSocket: client })
	}

	sendTo(ws, obj) {
		try {
			ws.send(JSON.stringify(obj))
		} catch {
			// ignore broken sockets; their close handler cleans up
		}
	}

	broadcast(obj, except) {
		for (const ws of this.peers.keys()) {
			if (ws !== except) this.sendTo(ws, obj)
		}
	}

	broadcastRoster() {
		const participants = [...this.peers.values()]
		this.broadcast({ type: 'roster', participants })
	}
}
