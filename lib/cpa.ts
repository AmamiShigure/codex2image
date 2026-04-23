// Server-only CPA client. Never import this from client components.
import 'server-only'

export type GenerateInput = {
  model: string
  prompt: string
  size: string // 'WIDTHxHEIGHT'
  quality?: 'auto' | 'low' | 'medium' | 'high'
}

export type CPAImage = {
  b64_json: string
  revised_prompt?: string
}

export type CPAResponse = {
  created: number
  data: CPAImage[]
  size?: string
  quality?: string
  background?: string
  output_format?: string
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    input_tokens_details?: { image_tokens: number; text_tokens: number }
    output_tokens_details?: { image_tokens: number; text_tokens: number }
  }
  error?: { message: string; type?: string; code?: string }
}

export function getCPAConfig() {
  const baseUrl = process.env.CPA_BASE_URL
  const apiKey = process.env.CPA_API_KEY
  const model = process.env.CPA_MODEL || 'gpt-image-2'
  if (!baseUrl || !apiKey) {
    throw new Error('CPA_BASE_URL and CPA_API_KEY must be set in environment')
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model }
}

/**
 * Call CPA /v1/images/generations. Returns raw CPA response.
 * Timeout 240s because gpt-image-2 single request is 30-120s depending on size.
 *
 * 注意：自 CPA v6.9.33/v6.9.34 起，OpenAI image handler 显式移除了对 `n` 参数的处理
 * (router-for-me/CLIProxyAPI commit: "remove handling of unsupported 'n' parameter
 * in OpenAI image handlers")，所以这里不再向 CPA 发送 `n` 字段。始终返回 1 张图。
 */
export async function generateImage(
  input: GenerateInput,
  signal?: AbortSignal,
): Promise<CPAResponse> {
  const { baseUrl, apiKey } = getCPAConfig()
  const url = `${baseUrl}/images/generations`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 240_000)
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        size: input.size,
        ...(input.quality && input.quality !== 'auto' ? { quality: input.quality } : {}),
      }),
      signal: controller.signal,
      cache: 'no-store',
    })
    const text = await res.text()
    let json: CPAResponse
    try {
      json = JSON.parse(text) as CPAResponse
    } catch {
      throw new Error(`CPA returned non-JSON (http=${res.status}): ${text.slice(0, 200)}`)
    }
    if (!res.ok || json.error) {
      const msg = json.error?.message || `CPA http=${res.status}`
      throw new Error(msg)
    }
    return json
  } finally {
    clearTimeout(timeout)
  }
}
