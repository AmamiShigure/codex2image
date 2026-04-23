import { NextRequest, NextResponse } from 'next/server'
import { generateImage, getCPAConfig } from '@/lib/cpa'
import { appendSizeHint, SIZE_PRESETS, type SizePreset, type Quality } from '@/lib/presets'

export const runtime = 'nodejs'
export const maxDuration = 300 // Vercel hobby max 300s (10s on free, 60s on Pro by default; set explicitly)

type Body = {
  prompt: string
  presetId?: string
  width?: number
  height?: number
  quality?: Quality
  appendHint?: boolean
}

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.prompt || typeof body.prompt !== 'string' || body.prompt.trim().length < 1) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  // Resolve preset
  let preset: SizePreset | undefined
  if (body.presetId) preset = SIZE_PRESETS.find((p) => p.id === body.presetId)
  const width = body.width ?? preset?.width ?? 1024
  const height = body.height ?? preset?.height ?? 1024

  // Basic validation matching OpenAI gpt-image-2 limits
  if (width % 16 !== 0 || height % 16 !== 0) {
    return NextResponse.json({ error: 'width/height must be multiples of 16' }, { status: 400 })
  }
  const totalPixels = width * height
  if (totalPixels < 655_360 || totalPixels > 8_294_400) {
    return NextResponse.json({ error: 'total pixels must be between 655,360 and 8,294,400' }, { status: 400 })
  }
  const ratioMax = Math.max(width, height) / Math.min(width, height)
  if (ratioMax > 3.01) {
    return NextResponse.json({ error: 'aspect ratio must be <= 3:1' }, { status: 400 })
  }

  const finalPrompt =
    body.appendHint !== false && preset
      ? appendSizeHint(body.prompt, preset)
      : body.appendHint !== false
      ? appendSizeHint(body.prompt, {
          id: 'custom',
          label: 'custom',
          ratio: `${width}:${height}`,
          width,
          height,
          orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square',
        } as SizePreset)
      : body.prompt

  const { model } = getCPAConfig()
  const t0 = Date.now()

  try {
    const resp = await generateImage({
      model,
      prompt: finalPrompt,
      size: `${width}x${height}`,
      quality: body.quality,
    })
    const image = resp.data?.[0]
    if (!image?.b64_json) {
      return NextResponse.json({ error: 'no image in response' }, { status: 502 })
    }
    return NextResponse.json({
      image: image.b64_json,
      revised_prompt: image.revised_prompt ?? null,
      size: resp.size ?? `${width}x${height}`,
      width,
      height,
      quality: resp.quality ?? body.quality ?? 'auto',
      ms: Date.now() - t0,
      usage: resp.usage ?? null,
    })
  } catch (err: any) {
    const ms = Date.now() - t0
    return NextResponse.json(
      { error: String(err?.message ?? err), ms },
      { status: 502 },
    )
  }
}

// Simple health check + preset listing
export async function GET() {
  const { model, baseUrl } = getCPAConfig()
  return NextResponse.json({
    ok: true,
    model,
    baseUrl,
    presets: SIZE_PRESETS,
  })
}
