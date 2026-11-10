export const SCREENSHOT_TYPES = ['image/webp', 'image/jpeg', 'image/png']
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024
export const MAX_SCREENSHOTS_PER_RUN = 20
export const DEFAULT_SCREENSHOT_CAP_MB = 200
export const MIN_SCREENSHOT_CAP_MB = 10
export const MAX_SCREENSHOT_CAP_MB = 5000

export const detectImageType = (bytes) => {
  if (!bytes || bytes.length < 12) return null
  if (startsWith(bytes, PNG_SIGNATURE)) return IMAGE_KINDS.png
  if (startsWith(bytes, JPEG_SIGNATURE)) return IMAGE_KINDS.jpeg
  if (isWebp(bytes)) return IMAGE_KINDS.webp
  return null
}

export const screenshotsToPrune = ({ rows, capBytes }) => {
  const oldestFirst = [...rows].sort(byAge)
  let total = oldestFirst.reduce((sum, row) => sum + row.bytes, 0)
  const doomed = []
  for (const row of oldestFirst) {
    if (total <= capBytes) break
    doomed.push(row.id)
    total -= row.bytes
  }
  return doomed
}

export const capBytesFromMb = (megabytes) => Number(megabytes) * 1024 * 1024

const IMAGE_KINDS = {
  png: { contentType: 'image/png', ext: 'png' },
  jpeg: { contentType: 'image/jpeg', ext: 'jpg' },
  webp: { contentType: 'image/webp', ext: 'webp' }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

const isWebp = (bytes) => startsWith(bytes, RIFF) && startsWith(bytes.subarray(8), WEBP)

const startsWith = (bytes, signature) =>
  signature.every((value, index) => bytes[index] === value)

const byAge = (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id
