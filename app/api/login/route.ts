import { NextRequest, NextResponse } from 'next/server'
import { buildSessionToken } from '@/lib/session'

export const runtime = 'nodejs'

const COOKIE_NAME = 'codex2image_auth'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export async function POST(req: NextRequest) {
  const pass = process.env.APP_PASSWORD
  if (!pass) return NextResponse.json({ ok: true, gateDisabled: true })

  let body: unknown = null
  try { body = await req.json() } catch {}
  const parsed = (body ?? {}) as { password?: unknown }
  const input = typeof parsed.password === 'string' ? parsed.password : ''

  if (input !== pass) {
    return NextResponse.json({ error: '密码错误' }, { status: 401 })
  }

  const isHttps = req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https'
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, await buildSessionToken(pass), {
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttps,
    path: '/',
    maxAge: MAX_AGE,
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
