import type { JSONContent } from '@tiptap/react'
import { CALLOUTS, type CalloutVariant } from '../editor/Callout'

function marks(text: string, ms: JSONContent['marks']) {
  let t = text
  for (const m of ms ?? []) {
    if (m.type === 'code') t = '`' + t + '`'
    else if (m.type === 'bold') t = `**${t}**`
    else if (m.type === 'italic') t = `*${t}*`
    else if (m.type === 'strike') t = `~~${t}~~`
    else if (m.type === 'highlight') t = `==${t}==`
    else if (m.type === 'link') t = `[${t}](${m.attrs?.href})`
  }
  return t
}

function inline(n: JSONContent): string {
  return (n.content ?? [])
    .map((c) => {
      if (c.type === 'text') return marks(c.text ?? '', c.marks)
      if (c.type === 'hardBreak') return '  \n'
      if (c.type === 'inlineMath') return `$${c.attrs?.latex}$`
      return inline(c)
    })
    .join('')
}

function block(n: JSONContent, indent = ''): string {
  switch (n.type) {
    case 'paragraph':
      return indent + inline(n)
    case 'heading':
      return '#'.repeat((n.attrs?.level ?? 1) + 1) + ' ' + inline(n)
    case 'bulletList':
      return (n.content ?? []).map((li) => listItem(li, indent, '- ')).join('\n')
    case 'orderedList':
      return (n.content ?? []).map((li, i) => listItem(li, indent, `${i + 1}. `)).join('\n')
    case 'taskList':
      return (n.content ?? []).map((li) => listItem(li, indent, li.attrs?.checked ? '- [x] ' : '- [ ] ')).join('\n')
    case 'blockquote':
      return (n.content ?? []).map((c) => '> ' + block(c)).join('\n>\n')
    case 'codeBlock': {
      const code = (n.content ?? []).map((c) => c.text ?? '').join('')
      const lang = n.attrs?.variant === 'terminal' ? 'bash' : n.attrs?.language === 'plaintext' ? '' : (n.attrs?.language ?? '')
      return '```' + lang + '\n' + code + '\n```'
    }
    case 'callout': {
      const v = CALLOUTS[(n.attrs?.variant as CalloutVariant) ?? 'important'] ?? CALLOUTS.important
      return `> ${v.icon} **${v.label}**\n` + (n.content ?? []).map((c) => '> ' + block(c)).join('\n')
    }
    case 'blockMath':
      return `$$\n${n.attrs?.latex}\n$$`
    case 'horizontalRule':
      return '---'
    case 'drawing':
      return '*[disegno a mano]*'
    case 'image':
      return `*[immagine: ${n.attrs?.alt || 'ritaglio slide'}]*`
    case 'table': {
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inline(p)).join(' ').replace(/\|/g, '\\|')))
      if (!rows.length) return ''
      const head = `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |`
      return head + rows.slice(1).map((r) => `\n| ${r.join(' | ')} |`).join('')
    }
    default:
      return (n.content ?? []).map((c) => block(c, indent)).join('\n\n')
  }
}

function listItem(li: JSONContent, indent: string, bullet: string) {
  const [first, ...rest] = li.content ?? []
  let s = indent + bullet + (first ? block(first).trimStart() : '')
  for (const r of rest) s += '\n' + block(r, indent + '   ')
  return s
}

export function docToMarkdown(doc: JSONContent | null | undefined) {
  if (!doc) return ''
  return (doc.content ?? [])
    .map((b) => block(b))
    .filter((s) => s.trim())
    .join('\n\n')
}

export function download(name: string, content: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
