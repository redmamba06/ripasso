import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  TerminalSquare,
  Table,
  Minus,
  Image as ImageIcon,
  Crop,
  Sparkles,
  Sigma,
  Link2,
  Type,
  Highlighter,
  ChevronRight,
  MessageCircleQuestion,
  ListTree,
  PencilLine,
  Grid3x3,
} from 'lucide-react'
import { bridge } from './bridge'
import { CALLOUTS, type CalloutVariant } from './Callout'
import { LANGUAGES } from './CodeBlock'
import { currentRef } from '../lib/viewer'
import { NO_AUTOLINK } from './SlideLink'
import { toast } from '../components/Toast'

export interface SlashItem {
  title: string
  desc: string
  group: string
  icon: React.ReactNode
  keys?: string
  run: (e: Editor, r: Range) => void
}

const I = 16
function baseItems(): SlashItem[] {
  const items: SlashItem[] = [
    { group: 'Base', title: 'Testo', desc: 'Paragrafo normale', icon: <Type size={I} />, keys: 'testo paragrafo text', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
    { group: 'Base', title: 'Titolo 1', desc: 'Titolo grande', icon: <Heading1 size={I} />, keys: 'h1 titolo heading', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
    { group: 'Base', title: 'Titolo 2', desc: 'Titolo di sezione', icon: <Heading2 size={I} />, keys: 'h2 titolo heading', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
    { group: 'Base', title: 'Titolo 3', desc: 'Sottotitolo', icon: <Heading3 size={I} />, keys: 'h3 titolo heading', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
    { group: 'Base', title: 'Elenco puntato', desc: 'Lista semplice', icon: <List size={I} />, keys: 'elenco lista bullet', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
    { group: 'Base', title: 'Elenco numerato', desc: 'Lista con numeri', icon: <ListOrdered size={I} />, keys: 'elenco numerato ordered', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
    { group: 'Base', title: 'Checklist', desc: 'Cose da fare / ripassare', icon: <ListChecks size={I} />, keys: 'todo checklist task', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
    { group: 'Base', title: 'Citazione', desc: 'Frase del prof o del libro', icon: <Quote size={I} />, keys: 'citazione quote', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
    { group: 'Base', title: 'Evidenziatore', desc: 'Evidenzia il testo', icon: <Highlighter size={I} />, keys: 'evidenzia highlight', run: (e, r) => e.chain().focus().deleteRange(r).toggleHighlight().run() },
    { group: 'Base', title: 'Divisore', desc: 'Linea di separazione', icon: <Minus size={I} />, keys: 'divisore linea hr', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
    { group: 'Studio', title: 'Domanda / risposta a scomparsa', desc: 'Nascondi la risposta per interrogarti', icon: <ChevronRight size={I} />, keys: 'toggle scomparsa details domanda risposta nascondi', run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run() },
    { group: 'Base', title: 'Tabella', desc: 'Tabella 3×3', icon: <Table size={I} />, keys: 'tabella table', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ]
  for (const [k, v] of Object.entries(CALLOUTS)) {
    items.push({
      group: 'Studio',
      title: v.label,
      desc: 'Riquadro evidenziato',
      icon: <span className="text-[15px] leading-none">{v.icon}</span>,
      keys: `callout box riquadro ${k} ${v.label}`,
      run: (e, r) => e.chain().focus().deleteRange(r).setCallout(k as CalloutVariant).run(),
    })
  }
  items.push(
    { group: 'Studio', title: 'Formula', desc: 'Formula matematica (LaTeX)', icon: <Sigma size={I} />, keys: 'formula latex math equazione', run: (e, r) => e.chain().focus().deleteRange(r).insertBlockMath({ latex: 'f(x) = x^2' }).run() },
    { group: 'Studio', title: 'Formula nel testo', desc: 'LaTeX in linea', icon: <Sigma size={I} />, keys: 'inline math formula', run: (e, r) => e.chain().focus().deleteRange(r).insertInlineMath({ latex: 'x^2' }).run() },
    {
      group: 'Codice',
      title: 'Terminale Linux',
      desc: 'Appunti sui comandi, con prompt $',
      icon: <TerminalSquare size={I} />,
      keys: 'terminale linux shell bash comandi',
      run: (e, r) =>
        e
          .chain()
          .focus()
          .deleteRange(r)
          .insertContent({ type: 'codeBlock', attrs: { language: 'bash', variant: 'terminal' }, content: [{ type: 'text', text: '$ ' }] })
          .run(),
    },
    { group: 'Codice', title: 'Blocco di codice', desc: 'Editor stile IDE', icon: <Code2 size={I} />, keys: 'codice code ide', run: (e, r) => e.chain().focus().deleteRange(r).setCodeBlock({ language: 'plaintext' }).run() },
  )
  for (const l of LANGUAGES.filter((x) => x.id !== 'plaintext')) {
    items.push({
      group: 'Codice',
      title: `Codice ${l.label}`,
      desc: 'Blocco IDE con evidenziazione',
      icon: <Code2 size={I} />,
      keys: `codice code ${l.id} ${l.label}`,
      run: (e, r) => e.chain().focus().deleteRange(r).setCodeBlock({ language: l.id }).run(),
    })
  }
  items.push(
    { group: 'A mano', title: 'Matita sugli appunti', desc: 'Scrivi a mano ovunque, anche sopra il testo', icon: <PencilLine size={I} />, keys: 'matita mano pencil scrivi sottolinea evidenzia disegno', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.startInk?.() } },
    { group: 'A mano', title: 'Foglio da disegno', desc: 'Riquadro per schemi grandi (Apple Pencil)', icon: <PencilLine size={I} />, keys: 'disegno schizzo mano pencil penna draw sketch', run: (e, r) => e.chain().focus().deleteRange(r).insertDrawing({ height: 360, bg: 'blank' }).run() },
    { group: 'A mano', title: 'Formula a mano', desc: 'Scrivila con la matita, poi “Formula” la converte', icon: <Sigma size={I} />, keys: 'formula mano pencil calcolo matematica', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.startInk?.() } },
    { group: 'A mano', title: 'Pagina a quadretti', desc: 'Foglio grande per esercizi', icon: <Grid3x3 size={I} />, keys: 'quadretti foglio esercizio mano pencil', run: (e, r) => e.chain().focus().deleteRange(r).insertDrawing({ height: 1200, bg: 'grid' }).run() },
    { group: 'Slide', title: 'Ritaglia dalla slide', desc: 'Seleziona una parte della slide', icon: <Crop size={I} />, keys: 'ritaglio screenshot slide immagine snip', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.startSnip?.() } },
    { group: 'Slide', title: 'Immagine', desc: 'Carica un’immagine', icon: <ImageIcon size={I} />, keys: 'immagine foto image', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.pickImage?.() } },
    {
      group: 'Slide',
      title: 'Collega alla slide aperta',
      desc: 'Aggiunge il collegamento al blocco',
      icon: <Link2 size={I} />,
      keys: 'collega link slide',
      run: (e, r) => {
        e.chain().focus().deleteRange(r).run()
        const ref = currentRef()
        if (!ref) return toast('Apri prima una slide', 'error')
        const { $from } = e.state.selection
        const pos = $from.depth >= 1 ? $from.before(1) : null
        if (pos == null) return
        e.chain().setBlockSlide(pos, ref).setMeta(NO_AUTOLINK, true).run()
      },
    },
    { group: 'AI', title: 'AI: appunti da questa slide', desc: 'Riassume la slide aperta negli appunti', icon: <Sparkles size={I} />, keys: 'ai riassumi appunti slide', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.aiFromSlide?.('notes') } },
    { group: 'AI', title: 'AI: spiegami la slide', desc: 'Apre la chat con la spiegazione', icon: <MessageCircleQuestion size={I} />, keys: 'ai spiega slide', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.aiFromSlide?.('explain') } },
    { group: 'AI', title: 'AI: domande di ripasso', desc: 'Domande sulla slide aperta', icon: <ListTree size={I} />, keys: 'ai domande quiz ripasso', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.aiFromSlide?.('questions') } },
  )
  return items
}

function filter(q: string) {
  const all = baseItems()
  const s = q.toLowerCase().trim()
  if (!s) return all.filter((i) => !(i.group === 'Codice' && i.title.startsWith('Codice ')) || i.title === 'Codice Python')
  return all.filter((i) => (i.title + ' ' + (i.keys ?? '') + ' ' + i.group).toLowerCase().includes(s)).slice(0, 30)
}

interface ListRef {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean
}
/** menu attualmente aperto (ne esiste al massimo uno) */
const activeList: { current: ListRef | null } = { current: null }

const SlashList = forwardRef<ListRef, SuggestionProps<SlashItem, SlashItem>>(function SlashList(props, ref) {
  const [sel, setSel] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => setSel(0), [props.items])
  useEffect(() => {
    box.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  const handler: ListRef = {
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setSel((s) => (s + 1) % Math.max(1, props.items.length))
        return true
      }
      if (event.key === 'ArrowUp') {
        setSel((s) => (s - 1 + props.items.length) % Math.max(1, props.items.length))
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const it = props.items[sel]
        if (it) props.command(it)
        return true
      }
      return false
    },
  }
  activeList.current = handler
  useImperativeHandle(ref, () => handler)
  useEffect(() => () => {
    if (activeList.current === handler) activeList.current = null
  })
  if (!props.items.length) return <div className="slash-menu"><div className="slash-empty">Nessun comando</div></div>
  let lastGroup = ''
  return (
    <div className="slash-menu" ref={box}>
      {props.items.map((it, i) => {
        const head = it.group !== lastGroup ? (lastGroup = it.group) : null
        return (
          <div key={it.title}>
            {head && <div className="slash-group">{head}</div>}
            <button data-i={i} className={`slash-item ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); props.command(it) }}>
              <span className="slash-icon">{it.icon}</span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium">{it.title}</span>
                <span className="block text-[11.5px] opacity-60 truncate">{it.desc}</span>
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
})

function Positioner({ rect, children }: { rect: DOMRect | null; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: -9999, top: -9999 })
  useLayoutEffect(() => {
    if (!rect || !ref.current) return
    const h = ref.current.offsetHeight
    const w = ref.current.offsetWidth
    let top = rect.bottom + 6
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6)
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - w - 8)
    setPos({ left, top })
  }, [rect, children])
  return (
    <div ref={ref} style={{ position: 'fixed', zIndex: 80, ...pos }}>
      {children}
    </div>
  )
}

type PProps = SuggestionProps<SlashItem, SlashItem> & { listRef: React.Ref<ListRef> }
function Popup(p: PProps) {
  const { listRef, ...rest } = p
  return (
    <Positioner rect={p.clientRect?.() ?? null}>
      <SlashList ref={listRef} {...rest} />
    </Positioner>
  )
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slash'),
        char: '/',
        allowSpaces: true,
        startOfLine: false,
        allowedPrefixes: [' ', ' '],
        items: ({ query }) => filter(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          return $from.parent.type.name !== 'codeBlock'
        },
        render: () => {
          let r: ReactRenderer<unknown, PProps> | null = null
          const listRef: { current: ListRef | null } = { current: null }
          return {
            onStart: (props) => {
              r = new ReactRenderer(Popup, { props: { ...props, listRef }, editor: props.editor })
              document.body.appendChild(r.element)
            },
            onUpdate: (props) => r?.updateProps({ ...props, listRef }),
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                r?.destroy()
                r?.element.remove()
                r = null
                return true
              }
              return activeList.current?.onKeyDown(props) ?? false
            },
            onExit: () => {
              r?.destroy()
              r?.element.remove()
              r = null
            },
          }
        },
      }),
    ]
  },
})
