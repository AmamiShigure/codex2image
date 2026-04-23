'use client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// Open-redirect protection for the ?next= query param.
// Only accept same-origin relative paths. Anything that could escape the site
// (absolute URLs, protocol-relative "//evil.com", backslash tricks) falls back
// to the homepage.
function isSafeNext(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '/'
  if (!raw.startsWith('/')) return '/'
  // "//foo" is protocol-relative; "/\\foo" is treated as protocol-relative by
  // some browsers. Reject both.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  return raw
}

function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  const next = isSafeNext(params.get('next'))
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pw) return
    setErr(null)
    setLoading(true)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      if (res.ok) {
        router.push(next)
        router.refresh()
        return
      }
      const j: any = await res.json().catch(() => ({}))
      setErr(j?.error || '密码错误')
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <form onSubmit={onSubmit} className="login-card">
        <h1>codex2image</h1>
        <p className="login-sub">请输入访问密码</p>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="密码"
          className="input"
        />
        {err && <div className="login-err">{err}</div>}
        <button type="submit" className="btn" disabled={loading || !pw}>
          {loading ? '验证中…' : '登录'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
