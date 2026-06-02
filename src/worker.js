// Bedtime — Cloudflare Worker entry point.
//
// Routes:
//   GET  /api/room/:roomId          -> WebSocket, forwarded to the Room Durable Object
//   POST /api/sessions/new          -> Realtime SFU: create a session
//   POST /api/sessions/:id/tracks/new
//   PUT  /api/sessions/:id/renegotiate
//   everything else                 -> static assets from ./public
//
// The browser never sees REALTIME_APP_SECRET: it calls these /api/sessions/*
// routes, and the Worker adds the Authorization header before forwarding to the
// real SFU at rtc.live.cloudflare.com.

import { Room } from './room.js'
export { Room }

const SFU_BASE = 'https://rtc.live.cloudflare.com/apps'

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		const { pathname } = url

		// --- Room signaling (WebSocket) -> Durable Object ---
		if (pathname.startsWith('/api/room/')) {
			const roomId = pathname.slice('/api/room/'.length)
			if (!roomId) return new Response('missing room id', { status: 400 })
			const id = env.ROOM.idFromName(roomId)
			return env.ROOM.get(id).fetch(request)
		}

		// --- TURN credentials (short-lived, minted server-side) ---
		if (pathname === '/api/turn') {
			return turnCredentials(env)
		}

		// --- Realtime SFU API proxy ---
		if (pathname === '/api/sessions/new') {
			return proxySFU(env, request, 'POST', '/sessions/new')
		}
		let m
		if ((m = pathname.match(/^\/api\/sessions\/([^/]+)\/tracks\/new$/))) {
			return proxySFU(env, request, 'POST', `/sessions/${m[1]}/tracks/new`)
		}
		if ((m = pathname.match(/^\/api\/sessions\/([^/]+)\/renegotiate$/))) {
			return proxySFU(env, request, 'PUT', `/sessions/${m[1]}/renegotiate`)
		}

		// --- Static front-end ---
		return env.ASSETS.fetch(request)
	},
}

async function proxySFU(env, request, method, path) {
	if (!env.REALTIME_APP_ID || !env.REALTIME_APP_SECRET) {
		return json({ error: 'Realtime app not configured. Set REALTIME_APP_ID and REALTIME_APP_SECRET.' }, 500)
	}
	const upstream = `${SFU_BASE}/${env.REALTIME_APP_ID}${path}`
	const init = {
		method,
		headers: {
			Authorization: `Bearer ${env.REALTIME_APP_SECRET}`,
			'Content-Type': 'application/json',
		},
	}
	// Forward the body for POST/PUT (sessions/new takes no body).
	if (method !== 'GET') {
		const body = await request.text()
		if (body) init.body = body
	}
	const res = await fetch(upstream, init)
	return new Response(await res.text(), {
		status: res.status,
		headers: { 'Content-Type': 'application/json' },
	})
}

// Mints short-lived TURN credentials for the browser. Without TURN configured,
// returns STUN-only — direct/STUN connections still work; only the relay
// fallback for restrictive networks is missing. The TURN API token never
// reaches the client.
const STUN_ONLY = [{ urls: ['stun:stun.cloudflare.com:3478'] }]

async function turnCredentials(env) {
	if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
		return json({ iceServers: STUN_ONLY })
	}
	try {
		const res = await fetch(
			`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ ttl: 3600 }),
			}
		)
		if (!res.ok) return json({ iceServers: STUN_ONLY })
		const data = await res.json()
		// Drop port-53 URLs: browsers block port 53 and would wait on a timeout.
		const iceServers = (data.iceServers || [])
			.map((s) => ({
				...s,
				urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
			}))
			.filter((s) => s.urls.length)
		return json({ iceServers: iceServers.length ? iceServers : STUN_ONLY })
	} catch {
		return json({ iceServers: STUN_ONLY })
	}
}

function json(obj, status = 200) {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}
