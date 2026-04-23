import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'codex2image · 卡牌立绘工具',
  description: 'gpt-image-2 批量生图 (经 CPA 代理)',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
