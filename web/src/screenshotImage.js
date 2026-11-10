export const MAX_SCREENSHOT_WIDTH = 1600
export const SCREENSHOT_QUALITY = 0.8

export const shrinkScreenshot = async (file) => {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SCREENSHOT_WIDTH / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const webp = await encode({ canvas, type: 'image/webp' })
  if (webp?.type === 'image/webp') return webp
  return encode({ canvas, type: 'image/jpeg' })
}

export const imageFiles = (items) => [...(items ?? [])]
  .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
  .map((item) => item.getAsFile())
  .filter(Boolean)

const encode = ({ canvas, type }) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, SCREENSHOT_QUALITY))
