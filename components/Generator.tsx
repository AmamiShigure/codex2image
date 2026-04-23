'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { appendSizeHint, CPA_MAX_SINGLE_EDGE, type Quality, type SizePreset } from '@/lib/presets'

type TaskStatus = 'pending' | 'running' | 'done' | 'error'

type Task = {
  id: string
  prompt: string
  finalPrompt: string
  presetId: string
  width: number
  height: number
  quality: Quality
  status: TaskStatus
  startedAt: number
  finishedAt?: number
  image?: string // b64_json
  revisedPrompt?: string | null
  error?: string
  selected?: boolean
}

type Props = {
  presets: SizePreset[]
  defaultPresetId: string
  defaultQuality: Quality
  qualityOptions: Quality[]
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default function Generator({ presets, defaultPresetId, defaultQuality, qualityOptions }: Props) {
  const [prompt, setPrompt] = useState('')
  const [presetId, setPresetId] = useState(defaultPresetId)
  const [useCustom, setUseCustom] = useState(false)
  const [customW, setCustomW] = useState(1024)
  const [customH, setCustomH] = useState(1024)
  const [quality, setQuality] = useState<Quality>(defaultQuality)
  const [count, setCount] = useState(4)
  const [concurrency, setConcurrency] = useState(8)
  const [appendHint, setAppendHint] = useState(true)
  const [autoDowngrade, setAutoDowngrade] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const [lightboxId, setLightboxId] = useState<string | null>(null)

  const activePreset = useMemo(() => presets.find((p) => p.id === presetId) ?? presets[0], [presets, presetId])

  const currentSize = useMemo(() => {
    if (useCustom) return { w: customW, h: customH, preset: undefined as SizePreset | undefined }
    return { w: activePreset.width, h: activePreset.height, preset: activePreset }
  }, [useCustom, customW, customH, activePreset])

  // Concurrency-limited runner. A single shared pool services both
  // `onGenerate` (initial batch) and `retryTask` (per-task retry button).
  // Without this shared pool, retries bypassed the queue entirely and N
  // rapid retry clicks fanned out to N concurrent requests, ignoring the
  // slider and any autoDowngrade in effect.
  const poolRef = useRef<{
    queue: Task[]
    running: number
    canceled: boolean
    started: boolean
    effectiveConc: { current: number }
  }>({ queue: [], running: 0, canceled: false, started: false, effectiveConc: { current: 8 } })
  const [running, setRunning] = useState(false)

  const runOne = useCallback(async (t: Task, effectiveConc: { current: number }): Promise<void> => {
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: 'running', startedAt: Date.now() } : x)))

    let attempt = 0
    const maxAttempts = 3

    while (attempt < maxAttempts) {
      attempt += 1
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: t.prompt,
            presetId: useCustom ? undefined : t.presetId,
            width: useCustom ? t.width : undefined,
            height: useCustom ? t.height : undefined,
            quality: t.quality,
            appendHint,
          }),
        })
        if (res.status === 429 || res.status === 503 || res.status === 502) {
          if (autoDowngrade && effectiveConc.current > 4) {
            effectiveConc.current = effectiveConc.current === 8 ? 6 : 4
          }
          if (attempt >= maxAttempts) {
            setTasks((prev) =>
              prev.map((x) => (x.id === t.id ? { ...x, status: 'error', error: `HTTP ${res.status} after ${maxAttempts} retries`, finishedAt: Date.now() } : x)),
            )
            return
          }
          const wait = 1500 * attempt
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        setTasks((prev) =>
          prev.map((x) =>
            x.id === t.id
              ? {
                  ...x,
                  status: 'done',
                  image: json.image,
                  revisedPrompt: json.revised_prompt ?? null,
                  finishedAt: Date.now(),
                }
              : x,
          ),
        )
        return
      } catch (err: any) {
        if (attempt >= maxAttempts) {
          setTasks((prev) =>
            prev.map((x) => (x.id === t.id ? { ...x, status: 'error', error: String(err?.message ?? err), finishedAt: Date.now() } : x)),
          )
          return
        }
        await new Promise((r) => setTimeout(r, 1500 * attempt))
      }
    }
  }, [appendHint, autoDowngrade, useCustom])

  const submitToPool = useCallback((newTasks: Task[]) => {
    const pool = poolRef.current
    pool.queue.push(...newTasks)
    // Sync effective concurrency with the slider on every submit. Also
    // re-arms after autoDowngrade stuck us at 4 in a previous batch.
    pool.effectiveConc.current = concurrency

    // Existing workers will pick up the newly pushed tasks from the queue.
    if (pool.started) return

    pool.started = true
    pool.canceled = false
    setRunning(true)

    const worker = async () => {
      while (!pool.canceled) {
        const next = pool.queue.shift()
        if (!next) break
        // Respect dynamic downgrade: pause if we exceed current effective concurrency
        while (pool.running >= pool.effectiveConc.current) {
          await new Promise((r) => setTimeout(r, 100))
        }
        pool.running += 1
        try { await runOne(next, pool.effectiveConc) } finally { pool.running -= 1 }
      }
    }

    const N = Math.min(concurrency, pool.queue.length)
    const workers: Promise<void>[] = []
    for (let i = 0; i < N; i++) workers.push(worker())
    Promise.all(workers).then(() => {
      pool.started = false
      setRunning(false)
    })
  }, [concurrency, runOne])

  const onGenerate = useCallback(() => {
    if (!prompt.trim()) return
    const w = currentSize.w
    const h = currentSize.h
    const p = currentSize.preset
    const newTasks: Task[] = Array.from({ length: count }).map(() => {
      const finalPrompt = appendHint
        ? p
          ? appendSizeHint(prompt, p)
          : appendSizeHint(prompt, {
              id: 'custom', label: 'custom', ratio: `${w}:${h}`, width: w, height: h,
              orientation: w > h ? 'landscape' : w < h ? 'portrait' : 'square',
            } as SizePreset)
        : prompt
      return {
        id: uid(),
        prompt,
        finalPrompt,
        presetId: p?.id ?? 'custom',
        width: w,
        height: h,
        quality,
        status: 'pending',
        startedAt: Date.now(),
      }
    })
    setTasks((prev) => [...newTasks, ...prev])
    submitToPool(newTasks)
  }, [prompt, currentSize, count, quality, appendHint, submitToPool])

  const toggleSelect = useCallback((id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t)))
  }, [])

  const selectAllDone = useCallback(() => {
    setTasks((prev) => prev.map((t) => (t.status === 'done' ? { ...t, selected: true } : t)))
  }, [])

  const clearSelection = useCallback(() => {
    setTasks((prev) => prev.map((t) => ({ ...t, selected: false })))
  }, [])

  const downloadSelected = useCallback(async () => {
    const picked = tasks.filter((t) => t.selected && t.image)
    if (picked.length === 0) return
    if (picked.length === 1) {
      const t = picked[0]!
      const a = document.createElement('a')
      a.href = `data:image/png;base64,${t.image}`
      a.download = `codex2image-${t.id}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      return
    }
    const zip = new JSZip()
    for (const t of picked) {
      zip.file(`${t.id}-${t.width}x${t.height}.png`, t.image!, { base64: true })
      zip.file(`${t.id}.txt`, `prompt:\n${t.prompt}\n\nfinalPrompt:\n${t.finalPrompt}\n\nrevised_prompt:\n${t.revisedPrompt ?? ''}\n`)
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `codex2image-batch-${Date.now()}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [tasks])

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const retryTask = useCallback((id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return
    const reset: Task = { ...t, status: 'pending', error: undefined, image: undefined, startedAt: Date.now(), finishedAt: undefined }
    setTasks((prev) => prev.map((x) => (x.id === id ? reset : x)))
    // Route the retry through the shared pool so it respects the concurrency
    // slider and any autoDowngrade in effect (fixes fan-out bug).
    submitToPool([reset])
  }, [tasks, submitToPool])

  const selectedCount = tasks.filter((t) => t.selected).length
  const doneCount = tasks.filter((t) => t.status === 'done').length
  const runningCount = tasks.filter((t) => t.status === 'running').length
  const errorCount = tasks.filter((t) => t.status === 'error').length
  const lightboxTask = lightboxId ? tasks.find((t) => t.id === lightboxId) : null

  useEffect(() => {
    if (!lightboxTask) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxTask])

  const downloadOne = useCallback((t: Task) => {
    if (!t.image) return
    const a = document.createElement('a')
    a.href = `data:image/png;base64,${t.image}`
    a.download = `codex2image-${t.id}-${t.width}x${t.height}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [])

  return (
    <div className="min-h-screen flex">
      {/* 左侧控制栏 */}
      <aside className="w-[340px] shrink-0 border-r border-border bg-panel p-5 overflow-y-auto flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">codex2image</h1>
          <p className="text-mute text-xs mt-1">gpt-image-2 · CPA 代理 · 并发批量生图</p>
        </div>

        <div>
          <label className="text-sm text-mute mb-1 block">提示词</label>
          <textarea
            className="textarea"
            placeholder="描述你想要的卡牌立绘…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm text-mute mb-1 block">尺寸预设</label>
          <select className="select" value={presetId} onChange={(e) => { setPresetId(e.target.value); setUseCustom(false) }} disabled={useCustom}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.width}×{p.height}{p.official ? ' ★' : ''}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 mt-2 text-xs text-mute cursor-pointer">
            <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
            自定义尺寸 (宽高必须是 16 的倍数)
          </label>
          {useCustom && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input type="number" step={16} min={256} max={CPA_MAX_SINGLE_EDGE} className="input" value={customW} onChange={(e) => setCustomW(Number(e.target.value))} placeholder="宽" />
              <input type="number" step={16} min={256} max={CPA_MAX_SINGLE_EDGE} className="input" value={customH} onChange={(e) => setCustomH(Number(e.target.value))} placeholder="高" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-mute mb-1 block">质量</label>
            <select className="select" value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
              {qualityOptions.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-mute mb-1 block">数量</label>
            <input type="number" min={1} max={32} className="input" value={count} onChange={(e) => setCount(Math.max(1, Math.min(32, Number(e.target.value) || 1)))} />
          </div>
        </div>

        <div>
          <label className="text-sm text-mute mb-1 block">并发数 ({concurrency})</label>
          <input type="range" min={1} max={8} step={1} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="w-full" />
          <div className="flex justify-between text-[10px] text-mute mt-1">
            <span>1</span><span>4</span><span>8</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-xs text-mute cursor-pointer">
            <input type="checkbox" checked={appendHint} onChange={(e) => setAppendHint(e.target.checked)} />
            自动追加尺寸提示 (提高命中率)
          </label>
          <label className="flex items-center gap-2 text-xs text-mute cursor-pointer">
            <input type="checkbox" checked={autoDowngrade} onChange={(e) => setAutoDowngrade(e.target.checked)} />
            限速时自动降档 (8→6→4)
          </label>
        </div>

        <button className="btn" onClick={onGenerate} disabled={running || !prompt.trim()}>
          {running ? `生成中… ${runningCount} 跑中 / ${doneCount} 完成` : `生成 ${count} 张`}
        </button>

        <div className="flex gap-2 text-xs">
          <span className="chip">总 {tasks.length}</span>
          <span className="chip">完成 {doneCount}</span>
          {errorCount > 0 && <span className="chip" style={ { color: '#ff8a8a' } }>失败 {errorCount}</span>}
        </div>
      </aside>

      {/* 右侧结果面板 */}
      <main className="flex-1 p-5 overflow-y-auto">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button className="btn-ghost btn" onClick={() => setSelectMode((v) => !v)}>
            {selectMode ? '退出选择' : '多选模式'}
          </button>
          {selectMode && <>
            <button className="btn-ghost btn" onClick={selectAllDone}>全选已完成</button>
            <button className="btn-ghost btn" onClick={clearSelection}>清空选择</button>
          </>}
          <button className="btn" onClick={downloadSelected} disabled={selectedCount === 0}>
            下载已选 ({selectedCount}) {selectedCount > 1 ? '→ .zip' : ''}
          </button>
          <div className="text-mute text-xs ml-auto">点开图片查看大图，右上角可重试/删除</div>
        </div>

        {tasks.length === 0 && (
          <div className="text-mute text-center mt-24">
            <p className="text-sm">填写提示词并点击左下试试～</p>
            <p className="text-xs mt-2">gpt-image-2 单张耗时 ≈45s，并发 8 也只要 ~55s 总时。</p>
          </div>
        )}

        <div className="masonry">
          {tasks.map((t) => (
            <div key={t.id} className={`card ${t.selected ? 'selected' : ''}`}>
              {selectMode && t.status === 'done' && (
                <div className="select-box" onClick={() => toggleSelect(t.id)}>
                  {t.selected ? '✓' : ''}
                </div>
              )}
              <div className="actions">
                {t.status === 'error' && <button onClick={() => retryTask(t.id)}>重试</button>}
                <button onClick={() => removeTask(t.id)}>×</button>
              </div>
              {t.status === 'done' && t.image ? (
                <img
                  src={`data:image/png;base64,${t.image}`}
                  alt={t.prompt}
                  onClick={() => (selectMode ? toggleSelect(t.id) : setLightboxId(t.id))}
                />
              ) : t.status === 'error' ? (
                <div className="p-4 text-xs text-[#ff8a8a]" style={{ aspectRatio: `${t.width} / ${t.height}`, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                  {t.error}
                </div>
              ) : (
                <div className="skeleton" style={{ ['--ar' as any]: `${t.width} / ${t.height}` }} />
              )}
              <div className="meta">
                <span>{t.width}×{t.height} · {t.quality}</span>
                <span className={`status-pill ${t.status === 'done' ? 'done' : t.status === 'error' ? 'error' : 'pending'}`}>
                  {t.status === 'done' && t.finishedAt ? `${((t.finishedAt - t.startedAt) / 1000).toFixed(1)}s` : t.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </main>

      {lightboxTask && lightboxTask.image && (
        <div className="lightbox" onClick={() => setLightboxId(null)}>
          <img
            src={`data:image/png;base64,${lightboxTask.image}`}
            alt={lightboxTask.prompt}
            onClick={(e) => e.stopPropagation()}
          />
          <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightboxId(null) }}>关闭 ✕</button>
          <div className="lightbox-meta" onClick={(e) => e.stopPropagation()}>
            <span>{lightboxTask.width}×{lightboxTask.height} · {lightboxTask.quality}</span>
            <button onClick={() => downloadOne(lightboxTask)}>下载 PNG</button>
          </div>
        </div>
      )}
    </div>
  )
}
