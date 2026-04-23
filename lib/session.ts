// Session token for the cookie-based password gate.
//
// The cookie value is an HMAC-SHA256 of a constant tag keyed by APP_PASSWORD,
// rendered as lowercase hex. Reading the cookie does NOT reveal the password
// (unlike the previous reversible base64("codex2image:" + password) scheme).
//
// Uses Web Crypto (SubtleCrypto) so the same code runs in both the Edge
// middleware runtime and the Node runtime used by /api/login.
export async function buildSessionToken(password: string): Promise<string> {
	const enc = new TextEncoder()
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(password),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const sig = await crypto.subtle.sign('HMAC', key, enc.encode('codex2image-session-v1'))
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

// Constant-time string comparison. Avoids timing-leak oracles when comparing
// the cookie token against the expected HMAC.
export function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false
	let diff = 0
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
	return diff === 0
}
