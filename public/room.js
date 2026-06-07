// Room identity helpers — collision-resistant, login-free room links.
//
// Two separate jobs (see README "Room links"):
//   - The SLUG (e.g. "brave-otter") is a human-readable handle whose only job is
//     to avoid ACCIDENTAL collisions between independent rooms running at the
//     same time. A collision is harmless and recoverable (the second party is
//     told "room in use" and just regenerates).
//   - The SECRET (e.g. "#k=7qx2") is the actual capability. It rides in the URL
//     *fragment*, so it never reaches the server or shows up in logs/Referer.
//     The Room Durable Object seals an occupied room to whoever holds it.
//
// All randomness uses crypto.getRandomValues (a CSPRNG) — never Math.random.

// ~220 simple, kid-friendly words: easy to read aloud and spell, no homophones.
// Two words give ~48k combos — plenty for this app, and a collision just means
// "regenerate". Add more words here to raise capacity.
export const WORDS = [
	'otter', 'maple', 'brave', 'cosmic', 'pillow', 'lantern', 'sleepy', 'amber',
	'willow', 'pebble', 'cozy', 'meadow', 'cloud', 'ginger', 'velvet', 'comet',
	'pumpkin', 'sunny', 'fuzzy', 'acorn', 'breezy', 'cocoa', 'dewy', 'ember',
	'frosty', 'glowy', 'honey', 'ivory', 'jolly', 'kitten', 'lilac', 'misty',
	'noble', 'olive', 'plucky', 'quiet', 'ruby', 'silky', 'tidy', 'merry',
	'violet', 'windy', 'zippy', 'bubbly', 'cheery', 'dapper', 'eager', 'fluffy',
	'gentle', 'happy', 'jumpy', 'kindly', 'lively', 'mellow', 'nimble', 'peppy',
	'rosy', 'snug', 'tiny', 'wobbly', 'badger', 'beaver', 'bunny', 'cricket',
	'dolphin', 'duckling', 'falcon', 'finch', 'fox', 'gecko', 'goose', 'hedgehog',
	'heron', 'koala', 'ladybug', 'lemur', 'llama', 'magpie', 'minnow', 'moose',
	'narwhal', 'newt', 'panda', 'parrot', 'pelican', 'penguin', 'pony', 'puffin',
	'quail', 'rabbit', 'raccoon', 'robin', 'salmon', 'seal', 'sparrow', 'squid',
	'starling', 'swan', 'tadpole', 'turtle', 'walrus', 'weasel', 'whale', 'wombat',
	'pinecone', 'anchor', 'apple', 'basket', 'beacon', 'biscuit', 'blanket', 'bonfire',
	'bubble', 'button', 'candle', 'canoe', 'castle', 'clover', 'compass', 'cottage',
	'crayon', 'cupcake', 'daisy', 'feather', 'fern', 'garden', 'harbor', 'island',
	'jelly', 'kettle', 'kite', 'ladder', 'lemon', 'marble', 'haystack', 'mitten',
	'muffin', 'nest', 'orchard', 'pancake', 'driftwood', 'planet', 'pocket', 'puddle',
	'quilt', 'raft', 'ribbon', 'river', 'rocket', 'sandbox', 'seashell', 'sled',
	'snowman', 'sprout', 'teapot', 'tepee', 'thistle', 'tulip', 'umbrella', 'valley',
	'wagon', 'whisker', 'window', 'yarn', 'breeze', 'brook', 'canyon', 'cliff',
	'stardust', 'crater', 'dawn', 'desert', 'dune', 'forest', 'galaxy', 'glacier',
	'grove', 'lagoon', 'meteor', 'moonlit', 'mountain', 'nebula', 'ocean', 'orbit',
	'prairie', 'rainbow', 'ripple', 'shimmer', 'snowdrift', 'starlight', 'sunbeam',
	'sunrise', 'tide', 'twilight', 'aurora', 'blossom', 'bramble', 'cedar', 'cherry',
	'cinnamon', 'clementine', 'dandelion', 'fig', 'hazel', 'juniper', 'lavender',
	'mango', 'nutmeg', 'peach', 'pear', 'plum', 'poppy', 'sage', 'spruce',
]

function randomInts(n) {
	const buf = new Uint32Array(n)
	crypto.getRandomValues(buf)
	return buf
}

// Two distinct words joined by "-", e.g. "brave-otter".
export function roomSlug() {
	const r = randomInts(2)
	const a = WORDS[r[0] % WORDS.length]
	let b = WORDS[r[1] % WORDS.length]
	if (b === a) b = WORDS[(r[1] + 1) % WORDS.length] // avoid "otter-otter"
	return `${a}-${b}`
}

// Short access secret for the URL fragment. 32-char unambiguous alphabet
// (no 0/o/1/l/i) — ~20 bits over 4 chars, e.g. "7qx2".
export function roomSecret(len = 4) {
	const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
	const r = crypto.getRandomValues(new Uint8Array(len))
	let out = ''
	for (let i = 0; i < len; i++) out += alphabet[r[i] % alphabet.length]
	return out
}

// Read { room, secret } from the current URL. The room comes from the short
// path "/r/<slug>" if present, else the legacy "?room=" query param (so old
// links keep working). The secret always lives in the fragment as "#k=...".
export function readRoomConfig() {
	const shortPath = location.pathname.match(/^\/r\/([^/]+)/)
	const room = shortPath
		? decodeURIComponent(shortPath[1])
		: new URLSearchParams(location.search).get('room') || 'storytime'
	const secret = new URLSearchParams(location.hash.replace(/^#/, '')).get('k') || ''
	return { room, secret }
}

// Build the short, shareable kid link, e.g. https://host/r/brave-otter#k=7qx2
export function viewerLink(origin, room, secret) {
	const base = `${origin}/r/${encodeURIComponent(room)}`
	return secret ? `${base}#k=${encodeURIComponent(secret)}` : base
}
