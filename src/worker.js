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

function json(obj, status = 200) {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}
