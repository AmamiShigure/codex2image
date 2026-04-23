import { NextRequest, NextResponse } from 'next/server'
import { buildSessionToken, constantTimeEqual } from '@/lib/session'

// Cookie-based password gate. Enabled whenever APP_PASSWORD is set.
// The user logs in via /login (password only) and gets a httpOnly cookie.
const COOKIE_NAME = 'codex2image_auth'

// Paths that must stay open so the login flow works.
const PUBLIC_PREFIXES = ['/login', '/api/login', '/api/health']

export async function middleware(req: NextRequest) {
  const pass = process.env.APP_PASSWORD
  const { pathname, search } = req.nextUrl

  // Fail-closed: if APP_PASSWORD is not configured, refuse every request except
  // the health endpoint. Prevents accidentally exposing the generate API when
  // the env var is missing (e.g. forgotten in a new deploy).
  if (!pass) {
    if (pathname === '/api/health') return NextResponse.next()
    return new NextResponse(
      JSON.stringify({ error: 'APP_PASSWORD is not configured on the server' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const token = req.cookies.get(COOKIE_NAME)?.value
  if (token) {
    const expected = await buildSessionToken(pass)
    if (constantTimeEqual(token, expected)) {
      return NextResponse.next()
    }
  }

  // GET requests → redirect to the login page, preserving the original destination.
  if (req.method === 'GET') {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }

  // Other methods (API calls) → plain 401 JSON.
  return new NextResponse(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
