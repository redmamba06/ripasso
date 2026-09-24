import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import Mathematics from '@tiptap/extension-mathematics'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import { CodeBlock } from './CodeBlock'
import { Callout } from './Callout'
import { AssetImage } from './AssetImage'
import { Drawing } from './Drawing'
import { SlideLink } from './SlideLink'
import { SlashCommand } from './SlashMenu'

export function buildExtensions(opts: { placeholder?: string; slash?: boolean } = {}) {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: true, autolink: true },
      heading: { levels: [1, 2, 3] },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Titolo'
        return opts.placeholder ?? 'Scrivi, oppure premi “/” per i comandi…'
      },
      includeChildren: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    Mathematics.configure({
      katexOptions: { throwOnError: false },
      blockOptions: {
        onClick: (node, pos) => {
          const latex = prompt('Formula LaTeX', node.attrs.latex)
          if (latex != null) editorRef.current?.chain().setNodeSelection(pos).updateBlockMath({ latex }).focus().run()
        },
      },
      inlineOptions: {
        onClick: (node, pos) => {
          const latex = prompt('Formula LaTeX', node.attrs.latex)
          if (latex != null) editorRef.current?.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run()
        },
      },
    }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'details' } }),
    DetailsSummary,
    DetailsContent,
    CodeBlock,
    Callout,
    AssetImage,
    Drawing,
    SlideLink,
    ...(opts.slash === false ? [] : [SlashCommand]),
  ]
}

import type { Editor } from '@tiptap/react'
export const editorRef: { current: Editor | null } = { current: null }
