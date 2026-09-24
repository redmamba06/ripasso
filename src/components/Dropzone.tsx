import { useRef, useState } from 'react'
import { UploadCloud } from 'lucide-react'

/** Area di caricamento: trascina file o clicca per sceglierli. */
export function Dropzone({
  onFiles,
  accept = 'application/pdf,image/*,.pdf',
  title = 'Trascina qui i PDF',
  hint = 'oppure clicca per sceglierli · puoi caricarne quanti vuoi',
  compact,
}: {
  onFiles: (f: File[]) => void
  accept?: string
  title?: string
  hint?: string
  compact?: boolean
}) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      className={`dropzone ${over ? 'over' : ''} ${compact ? 'compact' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const f = [...e.dataTransfer.files]
        if (f.length) onFiles(f)
      }}
    >
      <UploadCloud size={compact ? 20 : 30} className="dz-icon" />
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-[12.5px] opacity-60">{hint}</div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        hidden
        onChange={(e) => {
          const f = [...(e.target.files ?? [])]
          e.target.value = ''
          if (f.length) onFiles(f)
        }}
      />
    </div>
  )
}

/** Apre il selettore file del sistema. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement('input')
    i.type = 'file'
    i.accept = accept
    i.multiple = multiple
    i.onchange = () => res([...(i.files ?? [])])
    i.click()
  })
}
