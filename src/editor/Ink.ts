import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { LINKABLE } from './SlideLink'

/**
 * Scrittura a mano sopra gli appunti.
 * - ogni blocco di primo livello ha un id stabile (`bid`): i tratti a mano sono ancorati ai blocchi
 *   e seguono il testo quando si aggiungono o tolgono righe sopra;
 * - lo spazio "per la mano" sopra un blocco (dove si è disegnato nel vuoto) è una decorazione
 *   calcolata dai tratti, così il testo scritto al PC scorre sotto i disegni.
 */

export const INK_BLOCKS = [...LINKABLE, 'horizontalRule']
export const inkKey = new PluginKey<InkState>('inkSpace')

interface InkState {
  /** bid → spazio in unità (1 unità = 1/800 della larghezza del foglio) */
  spaces: Record<string, number>
  /** px per unità */
  k: number
}

const newBid = () => Math.random().toString(36).slice(2, 10)

export const Ink = Extension.create({
  name: 'ink',

  addGlobalAttributes() {
    return [
      {
        types: INK_BLOCKS,
        attributes: {
          bid: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-bid'),
            renderHTML: (a) => (a.bid ? { 'data-bid': a.bid } : {}),
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      // assegna/ripara gli id dei blocchi (nuovi blocchi, incolla, duplicati)
      new Plugin({
        key: new PluginKey('inkBid'),
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged) && !trs.some((t) => t.getMeta('inkInit'))) return null
          const seen = new Set<string>()
          let tr = null as null | typeof state.tr
          state.doc.forEach((node, offset) => {
            if (!('bid' in node.attrs)) return
            let bid = node.attrs.bid as string | null
            if (!bid || seen.has(bid)) {
              bid = newBid()
              tr = tr ?? state.tr
              tr.setNodeMarkup(offset, undefined, { ...node.attrs, bid })
            }
            seen.add(bid)
          })
          if (tr) (tr as typeof state.tr).setMeta('addToHistory', false).setMeta('noAutoLink', true)
          return tr
        },
      }),
      new Plugin<InkState>({
        key: inkKey,
        state: {
          init: () => ({ spaces: {}, k: 1 }),
          apply: (tr, v) => (tr.getMeta(inkKey) as InkState | undefined) ?? v,
        },
        props: {
          decorations(state) {
            const st = inkKey.getState(state)
            if (!st || !Object.keys(st.spaces).length) return null
            const decos: Decoration[] = []
            state.doc.forEach((node, offset) => {
              const sp = st.spaces[node.attrs?.bid as string]
              if (!sp) return
              decos.push(Decoration.node(offset, offset + node.nodeSize, { style: `margin-top: calc(0.55em + ${Math.round(sp * st.k)}px)`, class: 'ink-spaced' }))
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
