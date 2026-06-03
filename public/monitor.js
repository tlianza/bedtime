// monitor.js — thin, no-op-safe wrapper around Sentry.
//
// Sentry itself is loaded by the CDN loader <script> in each page's <head>
// (and configured there, with Session Replay disabled). These helpers just
// forward to it when present, and quietly no-op (console only) when it isn't —
// e.g. local dev, or if the CDN is blocked.

function S() {
	return typeof window !== 'undefined' ? window.Sentry : undefined
}

export function captureError(err, context) {
	const s = S()
	if (s && s.captureException) s.captureException(err, context ? { extra: context } : undefined)
	console.error('[monitor]', err, context || '')
}

// level: 'info' | 'warning' | 'error'
export function logEvent(message, data, level = 'info') {
	const s = S()
	if (s && s.captureMessage) s.captureMessage(message, { level, extra: data })
	console.log('[monitor]', level, message, data || '')
}

export function breadcrumb(message, data) {
	const s = S()
	if (s && s.addBreadcrumb) s.addBreadcrumb({ category: 'app', message, level: 'info', data })
}
