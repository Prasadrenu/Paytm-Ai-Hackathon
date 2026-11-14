// Shrink any image to a JPEG with a max side of 1280px, so uploads stay small and fast.
const MAX = 1280

// enhance: grayscale + contrast, which makes printed and handwritten text easier for OCR.
function draw(source, w, h, enhance = false, max = MAX) {
  const scale = Math.min(1, max / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')
  if (enhance) ctx.filter = 'grayscale(1) contrast(1.35) brightness(1.05)'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.88) // "data:image/jpeg;base64,...."
}

export async function fileToJpeg(file, enhance = false, max = MAX) {
  const bmp = await createImageBitmap(file)
  const url = draw(bmp, bmp.width, bmp.height, enhance, max)
  bmp.close()
  return url
}

// Documents keep more resolution than photos so small print stays readable.
export const videoToJpeg = (video, enhance = false, max = MAX) =>
  draw(video, video.videoWidth, video.videoHeight, enhance, max)
