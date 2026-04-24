// Server-only CPA client for /v1/images/edits. Never import from client components.
import 'server-only'
import type { CPAResponse } from './cpa'
import { getCPAConfig } from './cpa'

export type EditImageSource = {
  buffer: Buffer
  filename: string
  mimeType: string
}

export type EditInput = {
  model: string
  prompt: string
  size: string // 'WIDTHxHEIGHT'
  quality?: 'auto' | 'low' | 'medium' | 'high'
  images: EditImageSource[]
}

/**
 * Call CPA /v1/images/edits with multipart/form-data.
 *
 * Images are appended to the form in order as repeated `image` fields — this
 * is the same shape used by OpenAI SDK and Cherry Studio's NewApiPage.
 * The model treats the Nth `image` append as "Image N" in the prompt, so the
 * caller MUST preserve upload order.
 *
 * 240s timeout matches generateImage; multi-image 2K edits observed at 57s
 * for 2×512² inputs.
 */
export async function editImage(
  input: EditInput,
  signal?: AbortSignal,
): Promise<CPAResponse> {
  const { baseUrl, apiKey } = getCPAConfig()
  const url = `${baseUrl}/images/edits`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 240_000)
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true })

  try {
    const form = new FormData()
    form.append('model', input.model)
    form.append('prompt', input.prompt)
    form.append('size', input.size)
    if (input.quality && input.quality !== 'auto') {
      form.append('quality', input.quality)
    }
    for (const img of input.images) {
      const blob = new Blob([img.buffer], { type: img.mimeType })
      form.append('image', blob, img.filename)
    }

    const res = await fetch(url, {
      method: 'POST',
      // Intentionally omit Content-Type so fetch generates the boundary.
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    })
    const text = await res.text()
    let json: CPAResponse
    try {
      json = JSON.parse(text) as CPAResponse
    } catch {
      throw new Error(`CPA edits returned non-JSON (http=${res.status}): ${text.slice(0, 200)}`)
    }
    if (!res.ok || json.error) {
      const msg = json.error?.message || `CPA edits http=${res.status}`
      throw new Error(msg)
    }
    return json
  } finally {
    clearTimeout(timeout)
  }
}
