import { useAssetUrl } from '../editor/AssetImage'
import type { Course } from '../lib/db'

/** Logo del corso: la foto caricata se c'è, altrimenti l'emoji. */
export function CourseIcon({ course, className = '' }: { course: Pick<Course, 'emoji' | 'logo'>; className?: string }) {
  const url = useAssetUrl(course.logo ?? null, null)
  if (course.logo && url) return <img src={url} alt="" className={`course-logo ${className}`} draggable={false} />
  return <>{course.emoji}</>
}

/** Ritaglia al centro un quadrato e lo riduce a 320px (logo leggero da sincronizzare). */
export async function squareLogo(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Immagine non leggibile'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const size = Math.min(320, side)
    const c = document.createElement('canvas')
    c.width = c.height = size
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88))
    if (!blob) throw new Error('Impossibile elaborare l’immagine')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}
