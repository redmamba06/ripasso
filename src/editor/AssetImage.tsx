import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { getBlob } from '../lib/sync'
import { db, put, uid, type Asset } from '../lib/db'

const urlCache = new Map<string, string>()

export function useAssetUrl(asset: string | null, src: string | null) {
  const [url, setUrl] = useState<string | null>(asset ? (urlCache.get(asset) ?? null) : src)
  useEffect(() => {
    if (!asset) {
      setUrl(src)
      return
    }
    if (urlCache.has(asset)) {
      setUrl(urlCache.get(asset)!)
      return
    }
    let alive = true
    void getBlob(asset).then((b) => {
      if (!b || !alive) return
      const u = URL.createObjectURL(b)
      urlCache.set(asset, u)
      setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [asset, src])
  return url
}

export async function saveAsset(blob: Blob, courseId: string): Promise<string> {
  const id = uid()
  await db.blobs.put({ id, blob })
  await put<Asset>('assets', { id, courseId, mime: blob.type || 'image/png', uploaded: 0, updatedAt: 0 })
  urlCache.set(id, URL.createObjectURL(blob))
  return id
}

const SIZES = [
  { w: '35%', l: 'S' },
  { w: '60%', l: 'M' },
  { w: '100%', l: 'L' },
]

function View({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const url = useAssetUrl(node.attrs.asset, node.attrs.src)
  return (
    <NodeViewWrapper className={`img-block ${selected ? 'is-selected' : ''}`} data-slide={node.attrs.slide ?? undefined} data-drag-handle>
      <figure style={{ width: node.attrs.width || '100%' }}>
        {url ? <img src={url} alt={node.attrs.alt ?? ''} draggable={false} /> : <div className="img-loading">Caricamento immagine…</div>}
      </figure>
      {editor.isEditable && (
        <div className="img-tools" contentEditable={false}>
          {SIZES.map((s) => (
            <button key={s.l} className={node.attrs.width === s.w ? 'on' : ''} onClick={() => updateAttributes({ width: s.w })}>
              {s.l}
            </button>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const AssetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      asset: { default: null, parseHTML: (el) => el.getAttribute('data-asset'), renderHTML: (a) => (a.asset ? { 'data-asset': a.asset } : {}) },
      width: { default: '100%', parseHTML: (el) => el.getAttribute('data-width') || '100%', renderHTML: (a) => ({ 'data-width': a.width }) },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(View)
  },
}).configure({ allowBase64: true })
