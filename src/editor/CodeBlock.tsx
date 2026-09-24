import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createLowlight, common } from 'lowlight'
import { useState } from 'react'
import { Check, Copy, Sparkles, TerminalSquare, Loader2 } from 'lucide-react'
import { chat, SYSTEM_TUTOR } from '../lib/groq'
import { toast } from '../components/Toast'

export const lowlight = createLowlight(common)

export const LANGUAGES: { id: string; label: string }[] = [
  { id: 'plaintext', label: 'Testo' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'sql', label: 'SQL' },
  { id: 'bash', label: 'Bash / Shell' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'swift', label: 'Swift' },
  { id: 'php', label: 'PHP' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'r', label: 'R' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'makefile', label: 'Makefile' },
  { id: 'diff', label: 'Diff' },
  { id: 'lua', label: 'Lua' },
  { id: 'perl', label: 'Perl' },
  { id: 'vbnet', label: 'VB.NET' },
  { id: 'objectivec', label: 'Objective-C' },
]

function CodeView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const terminal = node.attrs.variant === 'terminal'
  const lang = node.attrs.language || 'plaintext'
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const lines = Math.max(1, node.textContent.split('\n').length)

  const copy = async () => {
    const txt = terminal
      ? node.textContent
          .split('\n')
          .filter((l) => l.startsWith('$ '))
          .map((l) => l.slice(2))
          .join('\n')
      : node.textContent
    await navigator.clipboard.writeText(txt || node.textContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const explain = async () => {
    const code = node.textContent.trim()
    if (!code) return
    setBusy(true)
    try {
      const prompt = terminal
        ? `Per ciascun comando Linux qui sotto (le righe che iniziano con "$ "), scrivi una spiegazione brevissima (max 12 parole) di cosa fa e delle opzioni usate.
Rispondi SOLO con le righe di commento, una per comando, nel formato "# <spiegazione>", nello stesso ordine.

${code}`
        : `Spiega in modo conciso cosa fa questo codice ${lang}, punto per punto (max 6 punti), in italiano. Evidenzia i concetti chiave.\n\n\`\`\`${lang}\n${code}\n\`\`\``
      const out = await chat(
        [
          { role: 'system', content: SYSTEM_TUTOR },
          { role: 'user', content: prompt },
        ],
        { maxTokens: 1500 },
      )
      const pos = typeof getPos === 'function' ? getPos() : null
      if (pos == null) return
      if (terminal) {
        const comments = out
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.startsWith('#'))
        const src = node.textContent.split('\n')
        const res: string[] = []
        let k = 0
        for (const l of src) {
          if (l.startsWith('$ ') && comments[k] && !(res.length && res[res.length - 1].startsWith('#'))) res.push(comments[k++])
          else if (l.startsWith('$ ')) k++
          res.push(l)
        }
        editor
          .chain()
          .command(({ tr, state }) => {
            const start = pos + 1
            tr.replaceWith(start, start + node.content.size, state.schema.text(res.join('\n')))
            return true
          })
          .run()
      } else {
        const { marked } = await import('marked')
        const html = await marked.parse(out)
        editor
          .chain()
          .insertContentAt(pos + node.nodeSize, `<div data-callout="info">${html}</div>`)
          .run()
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <NodeViewWrapper className={`code-shell ${terminal ? 'is-terminal' : 'is-ide'}`} data-slide={node.attrs.slide ?? undefined}>
      <div className="code-head" contentEditable={false}>
        {terminal ? (
          <>
            <span className="dots">
              <i style={{ background: '#ff5f57' }} />
              <i style={{ background: '#febc2e' }} />
              <i style={{ background: '#28c840' }} />
            </span>
            <span className="code-title">
              <TerminalSquare size={13} /> studente@linux: ~
            </span>
          </>
        ) : (
          <select className="code-lang" value={lang} onChange={(e) => updateAttributes({ language: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        )}
        <span className="flex-1" />
        {editor.isEditable && (
          <button className="code-btn" onClick={explain} disabled={busy} title={terminal ? 'Commenta i comandi con l’AI' : 'Spiega con l’AI'}>
            {busy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} <span className="max-sm:hidden">{terminal ? 'Commenta' : 'Spiega'}</span>
          </button>
        )}
        <button className="code-btn" onClick={copy} title="Copia">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <div className="code-body">
        {!terminal && (
          <div className="code-gutter" contentEditable={false} aria-hidden>
            {Array.from({ length: lines }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}
        <pre spellCheck={false}>
          <NodeViewContent<'code'> as="code" className={`hljs language-${terminal ? 'bash' : lang}`} />
        </pre>
      </div>
    </NodeViewWrapper>
  )
}

const termKey = new PluginKey('terminalPrompt')

function lineStartOffsets(text: string) {
  const out: number[] = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') out.push(i + 1)
  return out
}

export const CodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      variant: {
        default: 'ide',
        parseHTML: (el) => el.getAttribute('data-variant') || 'ide',
        renderHTML: (a) => ({ 'data-variant': a.variant }),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeView)
  },
  addKeyboardShortcuts() {
    const inCode = () => {
      const { $from } = this.editor.state.selection
      return $from.parent.type.name === this.name ? $from : null
    }
    return {
      ...this.parent?.(),
      Enter: () => {
        const $from = inCode()
        if (!$from) return false
        const text = $from.parent.textContent
        const offset = $from.parentOffset
        const lineStart = text.lastIndexOf('\n', offset - 1) + 1
        const line = text.slice(lineStart, offset)
        if ($from.parent.attrs.variant === 'terminal') {
          // Invio dopo un comando → nuova riga di prompt
          return this.editor.commands.insertContent('\n$ ')
        }
        const indent = line.match(/^\s*/)?.[0] ?? ''
        const extra = /[{([:]\s*$/.test(line) ? '    ' : ''
        return this.editor.commands.insertContent('\n' + indent + extra)
      },
      'Shift-Enter': () => {
        if (!inCode()) return false
        return this.editor.commands.insertContent('\n')
      },
      Tab: () => {
        if (!inCode()) return false
        return this.editor.commands.insertContent('    ')
      },
      'Mod-Enter': () => {
        const $from = inCode()
        if (!$from) return false
        const after = $from.after()
        return this.editor
          .chain()
          .insertContentAt(after, { type: 'paragraph' })
          .setTextSelection(after + 1)
          .run()
      },
    }
  },
  addProseMirrorPlugins() {
    const name = this.name
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: termKey,
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== name || node.attrs.variant !== 'terminal') return node.isBlock
              const text = node.textContent
              for (const s of lineStartOffsets(text)) {
                const from = pos + 1 + s
                if (text.startsWith('$', s)) decos.push(Decoration.inline(from, from + 1, { class: 'term-prompt' }))
                else if (text.startsWith('#', s)) {
                  const e = text.indexOf('\n', s)
                  decos.push(Decoration.inline(from, pos + 1 + (e < 0 ? text.length : e), { class: 'term-comment' }))
                } else if (s < text.length && text[s] !== '\n') {
                  const e = text.indexOf('\n', s)
                  decos.push(Decoration.inline(from, pos + 1 + (e < 0 ? text.length : e), { class: 'term-output' }))
                }
              }
              return false
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
}).configure({ lowlight, defaultLanguage: 'plaintext', enableTabIndentation: false } as never)
