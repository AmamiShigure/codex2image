// Server-only image upscaler. Never import from client components.
import 'server-only'
import sharp from 'sharp'
import type { UpscaleMethod } from './presets'

/**
 * Upscale an image buffer to (width, height).
 *
 * - lanczos: sharp + lanczos3 kernel. Pure CPU, <1s for 6MP→8MP on typical VPS.
 *   Ideal for small upscales (≤1.5×) on illustration / line-art / poster work,
 *   which is exactly our A4 scan case (2160×3072 → 2480×3507, 1.148×).
 *
 * - realesrgan: not yet wired. Falls back to lanczos with a warning.
 *   TODO: shell out to `realesrgan-ncnn-vulkan` CLI when available.
 *
 * Output is PNG (compressionLevel 6) to preserve sharp edges.
 */
export async function upscaleBuffer(
  input: Buffer,
  width: number,
  height: number,
  method: UpscaleMethod = 'lanczos',
): Promise<Buffer> {
  if (method === 'realesrgan') {
    // eslint-disable-next-line no-console
    console.warn('[upscale] realesrgan not yet wired, falling back to lanczos')
  }
  return sharp(input)
    .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
    .png({ compressionLevel: 6 })
    .toBuffer()
}
