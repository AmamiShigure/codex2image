import { NextRequest, NextResponse } from 'next/server'

// Cookie-based password gate. Enabled whenever APP_PASSWORD is set.
// The user logs in via /login (password only) and gets a httpOnly cookie.
const COOKIE_NAME = 'codex2image_auth'

// Paths that must stay open so the login flow works.
const PUBLIC_PREFIXES = ['/login', '/api/login', '/api/health']

function expectedToken(pass: string): string {
  // Cookie value is a non-reversible-ish encoding of the password.
  // httpOnly + Secure + SameSite=Strict keeps it out of JS and cross-site.
  return btoa(unescape(encodeURIComponent(`codex2image:${pass}`)))
}

export function middleware(req: NextRequest) {
  const pass = process.env.APP_PASSWORD
  if (!pass) return NextResponse.next()

  const { pathname, search } = req.nextUrl
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const token = req.cookies.get(COOKIE_NAME)?.value
  if (token && token === expectedToken(pass)) {
    return NextResponse.next()
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
