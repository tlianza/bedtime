# 📖 Bedtime

Read bedtime stories to your kids when you're away. You share your face + the book
(your Kindle Cloud Reader tab); they open a link on an iPad and see the book full-screen
with your face in the corner — and you can see and hear them too. Two-way, sub-second
latency, built on [Cloudflare Realtime](https://developers.cloudflare.com/realtime/sfu/).

## Two ways to read

The parent can project the book in either of two modes; the kid's page adapts automatically.

- **Screen-share mode** (`/reader`) — share your Kindle Cloud Reader tab. Needs a
  **Mac or laptop** (browsers on iPad/iOS can't screen-share). The book is sent as a live
  video track.
- **Book-file mode** (`/book`) — load a **PDF or page images** into the app and tap to turn
  pages; each page is sent to the kids as an image over the room channel. **Works on iPad**
  (and everywhere), gives crisp text, and avoids Kindle DRM. You supply the pages (scans /
  photos of books you own, public-domain PDFs, or purchased PDFs).

## How it works

- **Cloudflare Realtime SFU** carries the video/audio. Each person is one WebRTC session;
  you _push_ your tracks and _pull_ the other side's tracks.
- A **Worker** serves the front-end and proxies the SFU API so the App Secret stays
  server-side. A **Durable Object** is the "room" — it tracks who's connected and which
  tracks they publish, and tells each browser what to pull.
- The front-end is plain HTML + vanilla JS (no framework, no build step).

```
You (reader)                    SFU                    Kids (viewer)
  push screen (book) ───────────►  ◄─────────── pull screen  (full screen)
  push cam (face)    ───────────►  ◄─────────── pull cam     (corner PiP)
  push mic (voice)   ───────────►  ◄─────────── pull mic     (audio)
  pull cam + mic ◄──────────────   ───────────► push cam + mic
```

## One-time setup

### 1. Create a Realtime app (gets you the App ID + Secret)

In the Cloudflare dashboard: **Realtime → SFU → Create app** (or the Calls/Realtime API).
You'll get an **App ID** and an **App Secret**. Copy both.
Docs: https://developers.cloudflare.com/realtime/sfu/get-started/

### 2. Install deps

```bash
npm install
```

### 3. Add your credentials

For local dev, copy the example and fill it in:

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars -> REALTIME_APP_ID and REALTIME_APP_SECRET
```

## Run locally

```bash
npm run dev
```

Open the printed URL (usually `http://localhost:8787`). Click **Start reading (parent)**,
share your camera, then pick your **Kindle Cloud Reader** tab as the book. Open the kid
link in another tab/device to test the viewer side.

> Note: camera + screen sharing require a secure context. `localhost` counts as secure,
> so local dev works; in production you'll be on HTTPS via Cloudflare automatically.

## Deploy

Set your App ID and Secret on the deployed Worker (they're account-specific and not
committed to the repo), then deploy:

```bash
npx wrangler secret put REALTIME_APP_ID
npx wrangler secret put REALTIME_APP_SECRET
npm run deploy
```

You'll get a `*.workers.dev` URL (or attach your own domain). Open it, start a room,
and copy the kid link from the toolbar to send — see **Room links** below.

## Room links

There's no login. Starting a room auto-generates a memorable id and a short secret, e.g.:

```
https://<your-worker-url>/r/brave-otter#k=7qx2
```

- The **`room` slug** (`brave-otter`) is just a human-readable handle; its only job is to
  avoid two independent rooms colliding by accident. Two words from a curated list give
  tens of thousands of combos, and a collision is harmless — the second party is told
  "room in use" and regenerates.
- The **`#k=` secret** is the access control. It rides in the URL *fragment*, so it never
  reaches the server or shows up in logs. The Room admits the first person into an empty
  room (and adopts their secret), then **seals** it: anyone joining an occupied room must
  present the matching secret. So whoever has the link gets in; strangers who guess the
  slug don't. The secret is forgotten once the room empties.

This fits the usual "one reader + one kid" shape: the parent starts the room, sends the
link, and no one else can wander in while they're reading.

## Reading a Kindle book

Open the book in **Kindle Cloud Reader** (`read.amazon.com`) in a browser tab, then choose
that tab when prompted to share. ⚠️ **Test your specific book first**: most Kindle titles
screen-share fine, but some fixed-layout/comic titles or DRM may show black. Fallbacks:
point a webcam at a physical copy, or share a PDF/photos of the pages instead.

## Status / TODO

- [x] **TURN** relay for tricky networks (Cloudflare TURN; falls back to STUN if unset).
- [x] Recover from reloads and network drops (roster-diff re-pull + auto session rebuild
      with a "Reconnecting…" banner).
- [x] iOS audio-autoplay fallback ("Tap for sound") on the viewer.
- [x] Reader screen-share self-preview ("What you're sharing").
- [x] Login-free access control: auto-generated room ids + a secret in the link fragment;
      the room seals to the first joiner (see **Room links**).
- [ ] Expiring / rotating room links (the secret currently lasts as long as the room is in use).
- [ ] Mute/camera toggle buttons; a "raise hand" or page-turn ping would be cute.
- [ ] Tidy dead transceivers that accumulate across many reconnects (cosmetic).
