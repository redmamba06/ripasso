import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { currentRef } from '../lib/viewer'
import { settings } from '../lib/settings'

export const LINKABLE = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'blockquote',
  'image',
  'callout',
  'table',
  'blockMath',
  'details',
  'drawing',
]

export const NO_AUTOLINK = 'noAutoLink'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    slideLink: {
      setBlockSlide: (pos: number, ref: string | null) => ReturnType
    }
  }
}

/**
 * Ogni blocco di primo livello può avere un attributo `slide` ("fileId:pagina").
 * Se il collegamento automatico è attivo, un blocco nuovo scritto mentre una slide
 * è aperta riceve il riferimento a quella slide. "none" = rimosso volontariamente.
 */
export const SlideLink = Extension.create({
  name: 'slideLink',

  addGlobalAttributes() {
    return [
      {
        types: LINKABLE,
        attributes: {
          slide: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-slide'),
            renderHTML: (attrs) => (attrs.slide ? { 'data-slide': attrs.slide } : {}),
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setBlockSlide:
        (pos, ref) =>
        ({ tr, dispatch }) => {
          const node = tr.doc.nodeAt(pos)
          if (!node) return false
          if (dispatch) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, slide: ref })
            tr.setMeta(NO_AUTOLINK, true)
          }
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('slideAutoLink'),
        appendTransaction(trs, oldState, newState) {
          if (!settings().autoLink) return null
          if (!trs.some((t) => t.docChanged) || trs.some((t) => t.getMeta(NO_AUTOLINK) || t.getMeta('remote'))) return null
          const ref = currentRef()
          if (!ref) return null
          const start = oldState.doc.content.findDiffStart(newState.doc.content)
          if (start == null) return null
          const end = oldState.doc.content.findDiffEnd(newState.doc.content)
          const to = end ? Math.max(end.b, start) : newState.doc.content.size
          let tr = null as null | typeof newState.tr
          newState.doc.forEach((node, offset) => {
            const nodeEnd = offset + node.nodeSize
            if (nodeEnd < start || offset > to) return
            if (!LINKABLE.includes(node.type.name)) return
            if (node.attrs.slide) return
            const hasContent = node.type.name === 'image' || node.type.name === 'drawing' || node.textContent.trim().length > 0
            if (!hasContent) return
            tr = tr ?? newState.tr
            tr.setNodeMarkup(offset, undefined, { ...node.attrs, slide: ref })
          })
          if (tr) (tr as typeof newState.tr).setMeta('addToHistory', false)
          return tr
        },
      }),
    ]
  },
})
