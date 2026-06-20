/**
 * imageCompress.ts — Client-side adaptive image compression for chat attachments.
 *
 * Screenshots and pasted images are downscaled + re-encoded so they fit a
 * model-context-safe byte budget before being sent. Inlining full-resolution
 * base64 overflowed the gateway's text/image budget ("image context was too
 * long"); this keeps attachments small while preserving readability.
 *
 * Mirrors the approach of the openclaw-nerve client against the same gateway.
 */

export interface CompressImagePolicy {
  /** Hard upper bound on the encoded base64 byte size. */
  contextMaxBytes: number
  /** Preferred budget; the first encode at or below this wins. Defaults to 90% of max. */
  contextTargetBytes?: number
  /** Longest-edge cap before any byte-driven downscaling. */
  maxDimension: number
  /** Floor the downscale ladder won't go below. */
  minDimension: number
  /** Base WebP quality (percent). */
  webpQuality?: number
}

export const DEFAULT_IMAGE_POLICY: CompressImagePolicy = {
  contextMaxBytes: 32_768,
  maxDimension: 2048,
  minDimension: 512,
  webpQuality: 82,
}

function getBase64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

/** Sample for any non-opaque pixel (every 4th pixel) to decide PNG vs WebP. */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data
  for (let i = 3; i < data.length; i += 16) {
    if (data[i] < 250) return true
  }
  return false
}

function clampDimension(value: number): number {
  return Math.max(1, Math.round(value))
}

function buildQualityLadder(baseQualityPercent: number): number[] {
  const normalizedBase = Math.max(1, Math.min(100, Math.round(baseQualityPercent)))
  return Array.from(new Set([normalizedBase, 74, 66]))
}

function computeScaledSize(sourceWidth: number, sourceHeight: number, maxDimension: number): { width: number; height: number } {
  if (sourceWidth <= maxDimension && sourceHeight <= maxDimension) {
    return { width: sourceWidth, height: sourceHeight }
  }
  const ratio = Math.min(maxDimension / sourceWidth, maxDimension / sourceHeight)
  return { width: clampDimension(sourceWidth * ratio), height: clampDimension(sourceHeight * ratio) }
}

function computeDimensionRungs(startDimension: number, minDimension: number): number[] {
  const normalizedStart = clampDimension(startDimension)
  const normalizedMin = Math.min(normalizedStart, clampDimension(minDimension))
  const rungs: number[] = [normalizedStart]
  let current = normalizedStart
  while (current > normalizedMin) {
    const next = Math.max(normalizedMin, clampDimension(current * 0.85))
    if (next === current) break
    rungs.push(next)
    current = next
  }
  if (rungs[rungs.length - 1] !== normalizedMin) rungs.push(normalizedMin)
  return rungs
}

function loadImage(source: File | string): Promise<{ img: HTMLImageElement; revoke: () => void; mime: string }> {
  return new Promise((resolve, reject) => {
    const isFile = typeof source !== 'string'
    const url = isFile ? URL.createObjectURL(source) : source
    const mime = isFile
      ? source.type
      : (source.match(/^data:(image\/[a-z0-9.+-]+)/i)?.[1] ?? '')
    const img = new Image()
    img.onload = () => resolve({ img, revoke: () => { if (isFile) URL.revokeObjectURL(url) }, mime })
    img.onerror = () => { if (isFile) URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
    img.src = url
  })
}

/**
 * Compress an image (File or data-URL string) to an inline-safe data URL.
 * On any failure, resolves to the original data URL (string sources) so a send
 * is never blocked by compression. File sources reject on failure.
 */
export async function compressImageToDataUrl(
  source: File | string,
  policy: CompressImagePolicy = DEFAULT_IMAGE_POLICY,
): Promise<string> {
  let loaded: { img: HTMLImageElement; revoke: () => void; mime: string }
  try {
    loaded = await loadImage(source)
  } catch (err) {
    if (typeof source === 'string') return source
    throw err
  }
  const { img, revoke, mime } = loaded
  try {
    const sourceWidth = img.naturalWidth || img.width
    const sourceHeight = img.naturalHeight || img.height
    if (!sourceWidth || !sourceHeight) {
      return typeof source === 'string' ? source : await readFileAsDataUrl(source)
    }

    const startDimension = Math.min(clampDimension(policy.maxDimension), Math.max(sourceWidth, sourceHeight))
    const minDimension = Math.min(clampDimension(policy.minDimension), startDimension)
    const maxBytes = Math.max(1, Math.round(policy.contextMaxBytes))
    const targetBytes = Math.min(maxBytes, Math.max(1, Math.round(policy.contextTargetBytes ?? Math.floor(maxBytes * 0.9))))
    const qualityLadder = buildQualityLadder(policy.webpQuality ?? 82)
    const dimensionRungs = computeDimensionRungs(startDimension, minDimension)

    const probe = document.createElement('canvas')
    probe.width = sourceWidth
    probe.height = sourceHeight
    const probeCtx = probe.getContext('2d')
    if (!probeCtx) return typeof source === 'string' ? source : await readFileAsDataUrl(source)
    probeCtx.drawImage(img, 0, 0, sourceWidth, sourceHeight)

    const isPngLike = mime === 'image/png' || mime === 'image/webp'
    const preserveAlpha = isPngLike && hasAlpha(probeCtx, sourceWidth, sourceHeight)
    const mimeType = preserveAlpha ? 'image/png' : 'image/webp'
    const encodeQualities = preserveAlpha ? [100] : qualityLadder

    let firstAcceptable: string | null = null
    let bestEffort: string | null = null

    for (const maxDimension of dimensionRungs) {
      const { width, height } = computeScaledSize(sourceWidth, sourceHeight, maxDimension)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) break
      ctx.drawImage(img, 0, 0, width, height)

      for (const quality of encodeQualities) {
        const dataUrl = preserveAlpha ? canvas.toDataURL(mimeType) : canvas.toDataURL(mimeType, quality / 100)
        const base64 = dataUrl.split(',')[1] || ''
        const bytes = getBase64ByteLength(base64)
        bestEffort = dataUrl
        if (bytes <= targetBytes) return dataUrl
        if (bytes <= maxBytes && !firstAcceptable) firstAcceptable = dataUrl
      }
      if (firstAcceptable) return firstAcceptable
    }

    if (bestEffort) return bestEffort
    return typeof source === 'string' ? source : await readFileAsDataUrl(source)
  } finally {
    revoke()
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
