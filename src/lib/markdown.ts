import { marked } from 'marked'
import DOMPurify from 'dompurify'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Markdown (anche con formule $...$ / $$...$$) → HTML sicuro, pronto per l'editor o la chat. */
export async function mdToHtml(md: string, forEditor = true): Promise<string> {
  const blocks: string[] = []
  let src = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
      blocks.push(tex.trim())
      return `\n\n@@MATHBLOCK${blocks.length - 1}@@\n\n`
    })
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => {
      blocks.push(tex.trim())
      return `\n\n@@MATHBLOCK${blocks.length - 1}@@\n\n`
    })
  const inline: string[] = []
  src = src
    .replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_, pre, tex) => {
      inline.push(tex.trim())
      return `${pre}@@MATHIN${inline.length - 1}@@`
    })
    .replace(/\\\((.+?)\\\)/g, (_, tex) => {
      inline.push(tex.trim())
      return `@@MATHIN${inline.length - 1}@@`
    })
  let html = await marked.parse(src, { gfm: true, breaks: false })
  html = html
    .replace(/<p>@@MATHBLOCK(\d+)@@<\/p>/g, (_, i) => mathBlock(blocks[+i], forEditor))
    .replace(/@@MATHBLOCK(\d+)@@/g, (_, i) => mathBlock(blocks[+i], forEditor))
    .replace(/@@MATHIN(\d+)@@/g, (_, i) => mathInline(inline[+i], forEditor))
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-latex', 'data-type', 'data-callout', 'data-variant', 'target'] })
}

function mathBlock(tex: string, forEditor: boolean) {
  return forEditor ? `<div data-type="block-math" data-latex="${esc(tex)}"></div>` : `<div class="md-math-block" data-latex="${esc(tex)}"></div>`
}
function mathInline(tex: string, forEditor: boolean) {
  return forEditor ? `<span data-type="inline-math" data-latex="${esc(tex)}"></span>` : `<span class="md-math" data-latex="${esc(tex)}"></span>`
}

/** Rende le formule dentro un contenitore HTML già inserito nel DOM (chat). */
export async function renderMath(el: HTMLElement) {
  const nodes = el.querySelectorAll<HTMLElement>('.md-math, .md-math-block')
  if (!nodes.length) return
  const katex = (await import('katex')).default
  nodes.forEach((n) => {
    try {
      katex.render(n.dataset.latex ?? '', n, { throwOnError: false, displayMode: n.classList.contains('md-math-block') })
    } catch {
      n.textContent = n.dataset.latex ?? ''
    }
  })
}
