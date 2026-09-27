import { CourseIcon } from '../components/CourseIcon'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router-dom'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Printer, FileDown, ExternalLink, List } from 'lucide-react'
import { db, alive, type Unit } from '../lib/db'
import { buildExtensions } from '../editor/extensions'
import { docToMarkdown, download } from '../lib/export'
import { InkLayer } from '../components/InkLayer'
import type { InkStroke } from '../lib/ink'

function ReadOnly({ doc, ink }: { doc: JSONContent; ink?: InkStroke[] }) {
  const editor = useEditor({ extensions: buildExtensions({ slash: false }), content: doc, editable: false, immediatelyRender: true }, [JSON.stringify(doc).length])
  return (
    <div className="ink-wrap">
      <EditorContent editor={editor} className="editor-content readonly" />
      {editor && ink && ink.length > 0 && <InkLayer editor={editor} strokes={ink} readOnly />}
    </div>
  )
}

export default function Summary() {
  const { courseId } = useParams()
  const nav = useNavigate()
  const [toc, setToc] = useState(false)
  const data = useLiveQuery(async () => {
    const course = await db.courses.get(courseId!)
    const units = alive(await db.units.where('courseId').equals(courseId!).toArray()).sort((a, b) => a.order - b.order)
    const notes = alive(await db.notes.where('courseId').equals(courseId!).toArray())
    return { course, units, notes }
  }, [courseId])

  useEffect(() => {
    if (data?.course) document.title = `Summary — ${data.course.name}`
    return () => {
      document.title = 'Ripasso'
    }
  }, [data?.course])

  if (!data?.course) return null
  const { course, units, notes } = data
  const noteOf = (u: Unit) => notes.find((n) => n.unitId === u.id)
  const filled = units.filter((u) => noteOf(u)?.text.trim())

  const exportMd = () => {
    let md = `# ${course.name}\n\n`
    if (course.professor) md += `*${course.professor}*\n\n`
    md += `## Contents\n\n` + filled.map((u, i) => `${i + 1}. ${u.title}`).join('\n') + '\n\n'
    filled.forEach((u, i) => {
      md += `\n---\n\n# ${i + 1}. ${u.title}\n\n${docToMarkdown(noteOf(u)?.doc)}\n`
    })
    download(`Summary ${course.name}.md`, md)
  }

  const headings = (doc: JSONContent | null | undefined) =>
    (doc?.content ?? []).filter((b) => b.type === 'heading' && (b.attrs?.level ?? 1) <= 2).map((b) => (b.content ?? []).map((c) => c.text ?? '').join(''))

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setToc(false)
  }

  return (
    <div className="summary-page">
      <div className="summary-bar no-print">
        <button className="btn btn-ghost" onClick={() => nav(`/c/${course.id}?tab=summary`)}>
          <ArrowLeft size={16} /> <span className="hidden sm:inline">{course.name}</span>
        </button>
        <span className="flex-1" />
        <button className="btn lg:hidden" onClick={() => setToc(!toc)}>
          <List size={15} /> Contents
        </button>
        <button className="btn" onClick={exportMd}>
          <FileDown size={15} /> <span className="hidden sm:inline">Markdown</span>
        </button>
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={15} /> <span className="hidden sm:inline">Export PDF</span>
        </button>
      </div>
      <div className="summary-layout">
        <nav className={`summary-toc no-print ${toc ? 'open' : ''}`}>
          <div className="label">Contents</div>
          {filled.map((u, i) => (
            <div key={u.id}>
              <button className="toc-item" onClick={() => scrollTo('u-' + u.id)}>
                <span className="opacity-45 tabular-nums">{i + 1}</span> {u.title}
              </button>
              {headings(noteOf(u)?.doc).slice(0, 8).map((h, k) => (
                <div key={k} className="toc-sub">
                  {h}
                </div>
              ))}
            </div>
          ))}
        </nav>
        <article className="summary-doc">
          <header className="summary-cover" style={{ ['--c' as string]: course.color }}>
            <div className="summary-logo"><CourseIcon course={course} /></div>
            <h1>{course.name}</h1>
            <p>
              Full summary · {filled.length} unit{filled.length === 1 ? '' : 's'}{course.professor ? ` · ${course.professor}` : ''}
            </p>
          </header>
          {filled.length === 0 && <div className="empty">No notes yet: write in your units and the summary will build itself here.</div>}
          {filled.map((u, i) => (
            <motion.section key={u.id} id={'u-' + u.id} className="summary-unit" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
              <div className="summary-unit-head">
                <span className="unit-num big">{i + 1}</span>
                <h2 className="flex-1">{u.title}</h2>
                <button className="icon-btn sm no-print" title="Open unit" onClick={() => nav(`/u/${u.id}`)}>
                  <ExternalLink size={14} />
                </button>
              </div>
              <ReadOnly doc={noteOf(u)!.doc!} ink={noteOf(u)!.ink} />
            </motion.section>
          ))}
        </article>
      </div>
    </div>
  )
}
