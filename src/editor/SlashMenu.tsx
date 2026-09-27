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
    { group: 'Basic', title: 'Text', desc: 'Plain paragraph', icon: <Type size={I} />, keys: 'text paragraph testo', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
    { group: 'Basic', title: 'Heading 1', desc: 'Large heading', icon: <Heading1 size={I} />, keys: 'h1 titolo heading', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
    { group: 'Basic', title: 'Heading 2', desc: 'Section heading', icon: <Heading2 size={I} />, keys: 'h2 titolo heading', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
    { group: 'Basic', title: 'Heading 3', desc: 'Subheading', icon: <Heading3 size={I} />, keys: 'h3 titolo heading', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
    { group: 'Basic', title: 'Bullet list', desc: 'Simple list', icon: <List size={I} />, keys: 'bullet list elenco', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
    { group: 'Basic', title: 'Numbered list', desc: 'List with numbers', icon: <ListOrdered size={I} />, keys: 'numbered ordered list', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
    { group: 'Basic', title: 'Checklist', desc: 'Things to do / revise', icon: <ListChecks size={I} />, keys: 'todo checklist task', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
    { group: 'Basic', title: 'Quote', desc: 'A quote from the professor or the book', icon: <Quote size={I} />, keys: 'quote citation', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
    { group: 'Basic', title: 'Highlight', desc: 'Highlight the text', icon: <Highlighter size={I} />, keys: 'highlight marker', run: (e, r) => e.chain().focus().deleteRange(r).toggleHighlight().run() },
    { group: 'Basic', title: 'Divider', desc: 'Separator line', icon: <Minus size={I} />, keys: 'divider line hr separator', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
    { group: 'Study', title: 'Hidden Q&A', desc: 'Hide the answer to quiz yourself', icon: <ChevronRight size={I} />, keys: 'toggle details question answer hide collapse', run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run() },
    { group: 'Basic', title: 'Table', desc: '3×3 table', icon: <Table size={I} />, keys: 'table grid', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ]
  for (const [k, v] of Object.entries(CALLOUTS)) {
    items.push({
      group: 'Study',
      title: v.label,
      desc: 'Highlighted box',
      icon: <span className="text-[15px] leading-none">{v.icon}</span>,
      keys: `callout box ${k} ${v.label}`,
      run: (e, r) => e.chain().focus().deleteRange(r).setCallout(k as CalloutVariant).run(),
    })
  }
  items.push(
    { group: 'Study', title: 'Formula', desc: 'Math formula (LaTeX)', icon: <Sigma size={I} />, keys: 'formula latex math equation', run: (e, r) => e.chain().focus().deleteRange(r).insertBlockMath({ latex: 'f(x) = x^2' }).run() },
    { group: 'Study', title: 'Inline formula', desc: 'Inline LaTeX', icon: <Sigma size={I} />, keys: 'inline math formula', run: (e, r) => e.chain().focus().deleteRange(r).insertInlineMath({ latex: 'x^2' }).run() },
    {
      group: 'Codice',
      title: 'Linux terminal',
      desc: 'Notes on commands, with a $ prompt',
      icon: <TerminalSquare size={I} />,
      keys: 'terminal linux shell bash commands',
      run: (e, r) =>
        e
          .chain()
          .focus()
          .deleteRange(r)
          .insertContent({ type: 'codeBlock', attrs: { language: 'bash', variant: 'terminal' }, content: [{ type: 'text', text: '$ ' }] })
          .run(),
    },
    { group: 'Code', title: 'Code block', desc: 'IDE-style editor', icon: <Code2 size={I} />, keys: 'code ide', run: (e, r) => e.chain().focus().deleteRange(r).setCodeBlock({ language: 'plaintext' }).run() },
  )
  for (const l of LANGUAGES.filter((x) => x.id !== 'plaintext')) {
    items.push({
      group: 'Codice',
      title: `Code ${l.label}`,
      desc: 'IDE block with syntax highlighting',
      icon: <Code2 size={I} />,
      keys: `code ${l.id} ${l.label}`,
      run: (e, r) => e.chain().focus().deleteRange(r).setCodeBlock({ language: l.id }).run(),
    })
  }
  items.push(
    { group: 'Handwriting', title: 'Pencil on your notes', desc: 'Write by hand anywhere, even over the text', icon: <PencilLine size={I} />, keys: 'pencil hand write underline highlight draw ink', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.startInk?.() } },
    { group: 'Handwriting', title: 'Drawing sheet', desc: 'Box for large diagrams (Apple Pencil)', icon: <PencilLine size={I} />, keys: 'drawing sketch hand pencil pen draw diagram', run: (e, r) => e.chain().focus().deleteRange(r).insertDrawing({ height: 360, bg: 'blank' }).run() },
    { group: 'Handwriting', title: 'Handwritten formula', desc: 'Write it with the pencil, then “Formula” converts it', icon: <Sigma size={I} />, keys: 'formula hand pencil calculation math', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.startInk?.() } },
    { group: 'Handwriting', title: 'Grid page', desc: 'Large sheet for exercises', icon: <Grid3x3 size={I} />, keys: 'grid sheet exercise hand pencil', run: (e, r) => e.chain().focus().deleteRange(r).insertDrawing({ height: 1200, bg: 'grid' }).run() },
    { group: 'Slides', title: 'Snip from slide', desc: 'Select part of the slide', icon: <Crop size={I} />, keys: 'snip screenshot slide image crop', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.startSnip?.() } },
    { group: 'Slides', title: 'Image', desc: 'Upload an image', icon: <ImageIcon size={I} />, keys: 'image photo picture', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.pickImage?.() } },
    {
      group: 'Slide',
      title: 'Link to the open slide',
      desc: 'Adds the slide link to this block',
      icon: <Link2 size={I} />,
      keys: 'link slide',
      run: (e, r) => {
        e.chain().focus().deleteRange(r).run()
        const ref = currentRef()
        if (!ref) return toast('Open a slide first', 'error')
        const { $from } = e.state.selection
        const pos = $from.depth >= 1 ? $from.before(1) : null
        if (pos == null) return
        e.chain().setBlockSlide(pos, ref).setMeta(NO_AUTOLINK, true).run()
      },
    },
    { group: 'AI', title: 'AI: notes from this slide', desc: 'Summarises the open slide into your notes', icon: <Sparkles size={I} />, keys: 'ai summarise notes slide', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.aiFromSlide?.('notes') } },
    { group: 'AI', title: 'AI: explain the slide', desc: 'Opens the chat with an explanation', icon: <MessageCircleQuestion size={I} />, keys: 'ai explain slide', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.aiFromSlide?.('explain') } },
    { group: 'AI', title: 'AI: revision questions', desc: 'Questions about the open slide', icon: <ListTree size={I} />, keys: 'ai questions quiz revision', run: (e, r) => { e.chain().focus().deleteRange(r).run(); bridge.current?.aiFromSlide?.('questions') } },
  )
  return items
}

function filter(q: string) {
  const all = baseItems()
  const s = q.toLowerCase().trim()
  if (!s) return all.filter((i) => !(i.group === 'Code' && i.title.startsWith('Code ')) || i.title === 'Code Python')
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
  if (!props.items.length) return <div className="slash-menu"><div className="slash-empty">No commands</div></div>
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
