import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'

export const CALLOUTS = {
  important: { icon: '⭐', label: 'Importante' },
  exam: { icon: '🎯', label: 'Da sapere per l’esame' },
  definition: { icon: '📖', label: 'Definizione' },
  example: { icon: '💡', label: 'Esempio' },
  warning: { icon: '⚠️', label: 'Attenzione' },
  info: { icon: '🤖', label: 'Nota' },
  question: { icon: '❓', label: 'Da chiarire' },
} as const
export type CalloutVariant = keyof typeof CALLOUTS

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: { setCallout: (variant: CalloutVariant) => ReturnType }
  }
}

function View({ node, updateAttributes, editor }: NodeViewProps) {
  const v = (node.attrs.variant as CalloutVariant) in CALLOUTS ? (node.attrs.variant as CalloutVariant) : 'important'
  const keys = Object.keys(CALLOUTS) as CalloutVariant[]
  return (
    <NodeViewWrapper className={`callout callout-${v}`} data-slide={node.attrs.slide ?? undefined}>
      <button
        className="callout-icon"
        contentEditable={false}
        title={`${CALLOUTS[v].label} — clic per cambiare tipo`}
        onClick={() => editor.isEditable && updateAttributes({ variant: keys[(keys.indexOf(v) + 1) % keys.length] })}
      >
        {CALLOUTS[v].icon}
      </button>
      <div className="callout-body">
        <div className="callout-label" contentEditable={false}>
          {CALLOUTS[v].label}
        </div>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  )
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: 'important',
        parseHTML: (el) => el.getAttribute('data-callout') || 'important',
        renderHTML: (a) => ({ 'data-callout': a.variant }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(View)
  },
  addKeyboardShortcuts() {
    return {
      // Invio su una riga vuota alla fine del riquadro → si esce dal riquadro
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size) return false
        const d = $from.depth - 1
        if (d < 1 || $from.node(d).type.name !== this.name) return false
        if ($from.index(d) !== $from.node(d).childCount - 1) return false
        return editor.commands.lift('paragraph')
      },
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parentOffset !== 0) return false
        const d = $from.depth - 1
        if (d < 1 || $from.node(d).type.name !== this.name || $from.index(d) !== 0) return false
        return editor.commands.lift($from.parent.type.name)
      },
    }
  },
  addCommands() {
    return {
      setCallout:
        (variant) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { variant }),
    }
  },
})
