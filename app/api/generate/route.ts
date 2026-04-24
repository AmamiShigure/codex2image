import { NextRequest, NextResponse } from 'next/server'
import { generateImage, getCPAConfig } from '@/lib/cpa'
import { editImage, type EditImageSource } from '@/lib/cpa-edit'
import { appendSizeHint, SIZE_PRESETS, CPA_MAX_SINGLE_EDGE, type SizePreset, type Quality } from '@/lib/presets'

export const runtime = 'nodejs'
// Per-request time budget (seconds). Deployment-target caveats:
//   - Self-hosted (VPS, Docker, this project's default):  no platform limit, 300s is safe.
//   - Vercel Hobby (free tier):                           hard cap 10s — this value is ignored and requests > 10s get killed. Pick smaller size/quality or upgrade.
//   - Vercel Pro:                                         default 60s, max 300s (must set explicitly like this).
//   - Vercel Enterprise:                                  max 900s.
// gpt-image-2 at 1024² takes ~25-45s, so Hobby is effectively unusable for this app.
export const maxDuration = 300

type GenerateBody = {
  prompt: string
  presetId?: string
  width?: number
  height?: number
  quality?: Quality
  appendHint?: boolean
}

function resolveSize(presetId: string | undefined, widthIn: number | undefined, heightIn: number | undefined) {
  let preset: SizePreset | undefined
  if (presetId) preset = SIZE_PRESETS.find((p) => p.id === presetId)
  const width = widthIn ?? preset?.width ?? 1024
  const height = heightIn ?? preset?.height ?? 1024
  return { preset, width, height }
}

function validateSize(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 'width/height must be numbers'
  if (width % 16 !== 0 || height % 16 !== 0) return 'width/height must be multiples of 16'
  const total = width * height
  if (total < 655_360 || total > 8_294_400) return 'total pixels must be between 655,360 and 8,294,400'
  const ratioMax = Math.max(width, height) / Math.min(width, height)
  if (ratioMax > 3.01) return 'aspect ratio must be <= 3:1'
  if (Math.max(width, height) > CPA_MAX_SINGLE_EDGE) {
    return `max single edge is ${CPA_MAX_SINGLE_EDGE} (CPA upstream aborts larger requests)`
  }
  return null
}

function composePrompt(rawPrompt: string, appendHintFlag: boolean, preset: SizePreset | undefined, width: number, height: number) {
  if (!appendHintFlag) return rawPrompt
  if (preset) return appendSizeHint(rawPrompt, preset)
  return appendSizeHint(rawPrompt, {
    id: 'custom',
    label: 'custom',
    ratio: `${width}:${height}`,
    width,
    height,
    orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square',
    tier: 'preview',
  } as SizePreset)
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.startsWith('multipart/form-data')) {
    return handleEdit(req)
  }
  return handleGenerate(req)
}

async function handleGenerate(req: NextRequest): Promise<NextResponse> {
  let body: GenerateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.prompt || typeof body.prompt !== 'string' || body.prompt.trim().length < 1) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const { preset, width, height } = resolveSize(body.presetId, body.width, body.height)
  const sizeErr = validateSize(width, height)
  if (sizeErr) return NextResponse.json({ error: sizeErr }, { status: 400 })

  const finalPrompt = composePrompt(body.prompt, body.appendHint !== false, preset, width, height)
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
    return NextResponse.json({ error: String(err?.message ?? err), ms }, { status: 502 })
  }
}

async function handleEdit(req: NextRequest): Promise<NextResponse> {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
  }

  const prompt = form.get('prompt')
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const presetId = (form.get('presetId') as string | null) || undefined
  const widthStr = form.get('width') as string | null
  const heightStr = form.get('height') as string | null
  const qualityStr = form.get('quality') as string | null
  const appendHintFlag = (form.get('appendHint') as string | null) !== 'false'

  const quality: Quality | undefined =
    qualityStr === 'auto' || qualityStr === 'low' || qualityStr === 'medium' || qualityStr === 'high'
      ? qualityStr
      : undefined

  const { preset, width, height } = resolveSize(
    presetId,
    widthStr ? Number(widthStr) : undefined,
    heightStr ? Number(heightStr) : undefined,
  )
  const sizeErr = validateSize(width, height)
  if (sizeErr) return NextResponse.json({ error: sizeErr }, { status: 400 })

  const imageEntries = form.getAll('image')
  const images: EditImageSource[] = []
  for (const entry of imageEntries) {
    if (!(entry instanceof File)) continue
    if (entry.size === 0) continue
    // OpenAI /images/edits accepts PNG/JPEG/WEBP/GIF. Match Cherry Studio's accept list.
    const mime = entry.type || 'image/png'
    if (!mime.startsWith('image/')) {
      return NextResponse.json({ error: `unsupported file type: ${mime}` }, { status: 400 })
    }
    const buf = Buffer.from(await entry.arrayBuffer())
    images.push({
      buffer: buf,
      filename: entry.name || `image_${images.length + 1}.png`,
      mimeType: mime,
    })
  }
  if (images.length === 0) {
    return NextResponse.json({ error: 'at least one image is required for edit' }, { status: 400 })
  }
  if (images.length > 16) {
    return NextResponse.json({ error: 'up to 16 images allowed (OpenAI hard limit)' }, { status: 400 })
  }

  const finalPrompt = composePrompt(prompt, appendHintFlag, preset, width, height)
  const { model } = getCPAConfig()
  const t0 = Date.now()

  try {
    const resp = await editImage({
      model,
      prompt: finalPrompt,
      size: `${width}x${height}`,
      quality,
      images,
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
      quality: resp.quality ?? quality ?? 'auto',
      ms: Date.now() - t0,
      usage: resp.usage ?? null,
      editImageCount: images.length,
    })
  } catch (err: any) {
    const ms = Date.now() - t0
    return NextResponse.json({ error: String(err?.message ?? err), ms }, { status: 502 })
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
