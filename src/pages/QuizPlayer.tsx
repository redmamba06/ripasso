import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, X, Sparkles, Loader2, RotateCcw, Trophy, FileText, Pencil, Trash2, Eye, ListChecks, Save } from 'lucide-react'
import { db, put, uid, type Attempt, type AnswerResult, type Question, type Quiz } from '../lib/db'
import { gradeChoice, explainChoice, gradeOpen } from '../lib/quiz'
import { mdToHtml, renderMath } from '../lib/markdown'
import { toast } from '../components/Toast'
import { Modal } from '../components/Modal'

type Correction = 'now' | 'end'

export default function QuizPlayer() {
  const { quizId } = useParams()
  const nav = useNavigate()
  const quiz = useLiveQuery(() => db.quizzes.get(quizId!), [quizId])
  const course = useLiveQuery(async () => (quiz ? db.courses.get(quiz.courseId) : undefined), [quiz?.courseId])
  const [mode, setMode] = useState<Correction | null>(null)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [i, setI] = useState(0)
  const [editing, setEditing] = useState(false)

  if (!quiz || !course) return null
  const qs = quiz.questions

  const start = (m: Correction) => {
    setMode(m)
    setI(0)
    setAttempt({ id: uid(), quizId: quiz.id, courseId: quiz.courseId, answers: {}, score: 0, total: qs.length, finishedAt: null, updatedAt: 0 })
  }

  if (!mode || !attempt)
    return (
      <div className="page max-w-3xl">
        <button className="btn btn-ghost mb-4" onClick={() => nav(`/c/${course.id}?tab=quiz`)}>
          <ArrowLeft size={16} /> {course.name}
        </button>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-6 md:p-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="ai-logo big">
              <ListChecks size={20} />
            </span>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold tracking-tight truncate">{quiz.title}</h1>
              <div className="opacity-60 text-[14px]">
                {qs.length} domande · {qs.filter((q) => q.type !== 'open').length} a scelta · {qs.filter((q) => q.type === 'open').length} aperte
              </div>
            </div>
            <button className="icon-btn" title="Controlla e correggi le domande estratte" onClick={() => setEditing(true)}>
              <Pencil size={16} />
            </button>
          </div>
          <p className="text-[13.5px] opacity-65 mt-3">
            {qs.filter((q) => q.solutionFromPdf).length} domande hanno la soluzione presa dal PDF. Per le altre la correzione e la spiegazione sono fatte dall’AI (te lo segnalo).
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-6">
            <button className="mode-card" onClick={() => start('now')}>
              <Check size={20} />
              <b>Correggi domanda per domanda</b>
              <span>Vedi subito se è giusta e perché</span>
            </button>
            <button className="mode-card" onClick={() => start('end')}>
              <Trophy size={20} />
              <b>Simulazione d’esame</b>
              <span>Rispondi a tutto, correzione alla fine</span>
            </button>
          </div>
          <PastAttempts quiz={quiz} />
        </motion.div>
        <QuizEditor open={editing} onClose={() => setEditing(false)} quiz={quiz} />
      </div>
    )

  return <Runner quiz={quiz} courseName={course.name} mode={mode} attempt={attempt} setAttempt={setAttempt} i={i} setI={setI} onExit={() => setMode(null)} />
}

function PastAttempts({ quiz }: { quiz: Quiz }) {
  const list = useLiveQuery(async () => (await db.attempts.where('quizId').equals(quiz.id).toArray()).filter((a) => a.finishedAt && !a.deleted).sort((a, b) => b.finishedAt! - a.finishedAt!), [quiz.id]) ?? []
  if (!list.length) return null
  return (
    <div className="mt-6">
      <div className="label">Tentativi precedenti</div>
      <div className="flex flex-col gap-1.5">
        {list.slice(0, 6).map((a) => (
          <div key={a.id} className="flex items-center gap-3 text-[13.5px]">
            <span className="opacity-60 w-32">{new Date(a.finishedAt!).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            <div className="progress flex-1">
              <span style={{ width: `${(a.score / Math.max(1, a.total)) * 100}%` }} />
            </div>
            <b className="w-14 text-right">
              {Math.round((a.score / Math.max(1, a.total)) * 100)}%
            </b>
          </div>
        ))}
      </div>
    </div>
  )
}

function Runner({
  quiz,
  courseName,
  mode,
  attempt,
  setAttempt,
  i,
  setI,
  onExit,
}: {
  quiz: Quiz
  courseName: string
  mode: Correction
  attempt: Attempt
  setAttempt: (a: Attempt) => void
  i: number
  setI: (n: number) => void
  onExit: () => void
}) {
  const qs = quiz.questions
  const q = qs[i]
  const res = attempt.answers[q?.id ?? '']
  const [sel, setSel] = useState<number[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState<string | null>(null)
  const [review, setReview] = useState(false)
  const done = attempt.finishedAt != null

  useEffect(() => {
    const r = attempt.answers[q?.id ?? '']
    setSel(Array.isArray(r?.given) ? r.given : [])
    setText(typeof r?.given === 'string' ? r.given : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  const setAnswer = (id: string, r: AnswerResult) => {
    const a = { ...attempt, answers: { ...attempt.answers, [id]: r } }
    setAttempt(a)
    return a
  }

  const check = async () => {
    if (!q) return
    setBusy(true)
    try {
      if (q.type === 'open') {
        const r = await gradeOpen(q, text, courseName)
        setAnswer(q.id, r)
      } else {
        const correct = gradeChoice(q, sel)
        const ex = await explainChoice(q, sel, courseName)
        const ok = correct ?? (ex.aiCorrect ? gradeChoice({ ...q, correct: ex.aiCorrect }, sel) : null)
        setAnswer(q.id, { given: sel, correct: ok, feedback: ex.text, aiCorrect: q.correct ? undefined : ex.aiCorrect })
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const store = () => {
    if (!q) return attempt
    if (q.type === 'open') return text.trim() ? setAnswer(q.id, { ...(attempt.answers[q.id] ?? {}), given: text, correct: attempt.answers[q.id]?.correct ?? null }) : attempt
    return sel.length ? setAnswer(q.id, { ...(attempt.answers[q.id] ?? {}), given: sel, correct: gradeChoice(q, sel) }) : attempt
  }

  const next = () => {
    if (!done) store()
    if (i < qs.length - 1) setI(i + 1)
  }
  const prev = () => {
    if (!done) store()
    if (i > 0) setI(i - 1)
  }

  const finish = async () => {
    let a = mode === 'end' ? store() : attempt
    setFinishing('Correggo…')
    try {
      // valuta le aperte non ancora corrette + scelte senza soluzione nota
      let k = 0
      for (const qq of qs) {
        k++
        const r = a.answers[qq.id]
        if (!r || r.feedback) continue
        if (qq.type === 'open' && typeof r.given === 'string' && r.given.trim()) {
          setFinishing(`Correggo la domanda aperta ${k}/${qs.length}…`)
          const g = await gradeOpen(qq, r.given, courseName)
          a = { ...a, answers: { ...a.answers, [qq.id]: g } }
        } else if (qq.type !== 'open' && Array.isArray(r.given) && (r.correct === false || r.correct == null)) {
          setFinishing(`Preparo la spiegazione ${k}/${qs.length}…`)
          const ex = await explainChoice(qq, r.given, courseName)
          const ok = r.correct ?? (ex.aiCorrect ? gradeChoice({ ...qq, correct: ex.aiCorrect }, r.given) : null)
          a = { ...a, answers: { ...a.answers, [qq.id]: { ...r, correct: ok, feedback: ex.text, aiCorrect: qq.correct ? undefined : ex.aiCorrect } } }
        }
        setAttempt(a)
      }
    } catch (e) {
      toast((e as Error).message + ' — alcune correzioni mancano', 'error')
    }
    const score = qs.reduce((s, qq) => {
      const r = a.answers[qq.id]
      if (!r) return s
      if (qq.type === 'open') return s + (r.score ?? 0)
      return s + (r.correct ? 1 : 0)
    }, 0)
    a = { ...a, score: Math.round(score * 10) / 10, finishedAt: Date.now() }
    setAttempt(a)
    await put<Attempt>('attempts', a)
    setFinishing(null)
    setReview(false)
  }

  if (finishing)
    return (
      <div className="page flex flex-col items-center justify-center gap-4 min-h-[60vh]">
        <Loader2 size={34} className="spin text-accent" />
        <div className="font-medium">{finishing}</div>
      </div>
    )

  if (done && !review) return <Results quiz={quiz} attempt={attempt} onReview={(n) => { setI(n); setReview(true) }} onRestart={onExit} />

  const answered = Object.keys(attempt.answers).length
  const showResult = !!res?.feedback && (mode === 'now' || done)
  const aiCorrect = res?.aiCorrect
  const correctSet = q.correct ?? aiCorrect ?? null

  return (
    <div className="quiz-page">
      <div className="quiz-top">
        <button className="icon-btn" onClick={() => (done ? setReview(false) : confirm('Uscire dal quiz? Le risposte non corrette andranno perse.') && onExit())}>
          <X size={18} />
        </button>
        <div className="flex-1">
          <div className="progress">
            <motion.span animate={{ width: `${((i + 1) / qs.length) * 100}%` }} />
          </div>
        </div>
        <div className="text-[13px] opacity-70 tabular-nums">
          {i + 1}/{qs.length}
        </div>
      </div>

      <div className="quiz-dots">
        {qs.map((qq, k) => {
          const r = attempt.answers[qq.id]
          const cls = r?.feedback || done ? (r?.correct ? 'ok' : r?.correct === false ? 'ko' : r ? 'ans' : '') : r ? 'ans' : ''
          return <button key={qq.id} className={`qdot ${cls} ${k === i ? 'cur' : ''}`} onClick={() => { if (!done) store(); setI(k) }} title={`Domanda ${k + 1}`} />
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={q.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }} className="quiz-card card">
          <div className="flex items-center gap-2 text-[12px] mb-3 flex-wrap">
            <span className="pill">{q.number ? `Domanda ${q.number}` : `Domanda ${i + 1}`}</span>
            <span className="pill soft">{q.type === 'open' ? 'Aperta' : q.type === 'multi' ? 'Risposta multipla' : q.type === 'truefalse' ? 'Vero / Falso' : 'Scelta singola'}</span>
            {q.points && <span className="pill soft">{q.points} pt</span>}
            {q.page && (
              <span className="opacity-50 flex items-center gap-1">
                <FileText size={12} /> pag. {q.page}
              </span>
            )}
          </div>
          <div className="quiz-q">{q.text}</div>

          {q.type !== 'open' ? (
            <div className="flex flex-col gap-2 mt-5">
              {q.options.map((o, k) => {
                const picked = sel.includes(k)
                const isCorrect = showResult && correctSet?.includes(k)
                const isWrong = showResult && picked && !correctSet?.includes(k)
                return (
                  <motion.button
                    key={k}
                    whileTap={{ scale: 0.99 }}
                    disabled={showResult}
                    className={`opt ${picked ? 'picked' : ''} ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''}`}
                    onClick={() => setSel(q.type === 'multi' ? (picked ? sel.filter((x) => x !== k) : [...sel, k]) : [k])}
                  >
                    <span className="opt-letter">{String.fromCharCode(65 + k)}</span>
                    <span className="flex-1 text-left">{o}</span>
                    {isCorrect && <Check size={18} />}
                    {isWrong && <X size={18} />}
                  </motion.button>
                )
              })}
            </div>
          ) : (
            <textarea className="field mt-5 min-h-[160px] font-[inherit]" placeholder="Scrivi la tua risposta…" value={text} disabled={showResult} onChange={(e) => setText(e.target.value)} />
          )}

          {showResult && res && <Feedback q={q} r={res} aiCorrect={!q.correct && q.type !== 'open' ? aiCorrect : undefined} />}
        </motion.div>
      </AnimatePresence>

      <div className="quiz-nav">
        <button className="btn" onClick={prev} disabled={i === 0}>
          <ArrowLeft size={16} /> <span className="hidden sm:inline">Indietro</span>
        </button>
        <span className="flex-1" />
        {mode === 'now' && !showResult && !done && (
          <button className="btn btn-primary" onClick={check} disabled={busy || (q.type === 'open' ? !text.trim() : !sel.length)}>
            {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Correggi
          </button>
        )}
        {i < qs.length - 1 ? (
          <button className={`btn ${mode === 'end' || showResult || done ? 'btn-primary' : ''}`} onClick={next}>
            <span className="hidden sm:inline">Avanti</span> <ArrowRight size={16} />
          </button>
        ) : done ? (
          <button className="btn btn-primary" onClick={() => setReview(false)}>
            Risultati
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => (mode === 'end' && answered + (sel.length || text.trim() ? 1 : 0) < qs.length ? confirm('Ci sono domande senza risposta. Consegnare comunque?') && finish() : finish())}>
            <Trophy size={16} /> Consegna
          </button>
        )}
      </div>
    </div>
  )
}

function Feedback({ q, r, aiCorrect }: { q: Question; r: AnswerResult; aiCorrect?: number[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState('')
  useEffect(() => {
    void mdToHtml(r.feedback ?? '', false).then(setHtml)
  }, [r.feedback])
  useEffect(() => {
    if (ref.current) void renderMath(ref.current)
  }, [html])
  const open = q.type === 'open'
  const sc = r.score ?? 0
  const state: 'ok' | 'partial' | 'ko' | 'unk' = open ? (sc >= 0.85 ? 'ok' : sc >= 0.3 ? 'partial' : 'ko') : r.correct ? 'ok' : r.correct === false ? 'ko' : 'unk'
  const label = open
    ? `${state === 'ok' ? 'Corretta' : state === 'partial' ? 'Parzialmente corretta' : 'Da rivedere'} · ${Math.round(sc * 100)}%`
    : state === 'ok'
      ? 'Corretta!'
      : state === 'ko'
        ? 'Sbagliata'
        : 'Risposta registrata'
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`feedback ${state}`}>
      <div className="flex items-center gap-2 font-semibold mb-2">
        {state === 'ok' ? <Check size={18} /> : state === 'unk' ? <Sparkles size={18} /> : <X size={18} />}
        {label}
      </div>
      {!q.solutionFromPdf && (
        <div className="text-[12px] opacity-70 mb-2">⚠️ Il PDF non contiene la soluzione: {aiCorrect ? 'la risposta indicata come corretta è stata stabilita dall’AI' : 'la valutazione è dell’AI'}, verificala.</div>
      )}
      {q.type === 'open' && q.solution && (
        <details className="mb-2">
          <summary className="cursor-pointer text-[13px] font-medium flex items-center gap-1">
            <Eye size={13} /> Soluzione ufficiale (dal PDF)
          </summary>
          <div className="mt-2 text-[13.5px] whitespace-pre-wrap opacity-85">{q.solution}</div>
        </details>
      )}
      <div className="md text-[14px]" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
    </motion.div>
  )
}

function Results({ quiz, attempt, onReview, onRestart }: { quiz: Quiz; attempt: Attempt; onReview: (i: number) => void; onRestart: () => void }) {
  const pct = Math.round((attempt.score / Math.max(1, attempt.total)) * 100)
  const nav = useNavigate()
  const wrong = quiz.questions.map((q, i) => ({ q, i, r: attempt.answers[q.id] })).filter((x) => !x.r || !x.r.correct)
  return (
    <div className="page max-w-3xl">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card text-center p-8">
        <div className="result-ring" style={{ ['--p' as string]: pct }}>
          <span>{pct}%</span>
        </div>
        <h1 className="text-2xl font-bold mt-4">{pct >= 85 ? 'Ottimo lavoro! 🎉' : pct >= 60 ? 'Ci sei quasi 💪' : 'Continua a ripassare 📚'}</h1>
        <p className="opacity-65 mt-1">
          {attempt.score} su {attempt.total} punti · {quiz.title}
        </p>
        <div className="flex justify-center gap-2 mt-5 flex-wrap">
          <button className="btn" onClick={() => nav(`/c/${quiz.courseId}?tab=quiz`)}>
            <ArrowLeft size={16} /> Torna ai quiz
          </button>
          <button className="btn btn-primary" onClick={onRestart}>
            <RotateCcw size={16} /> Rifai
          </button>
        </div>
      </motion.div>
      {wrong.length > 0 && (
        <div className="mt-6">
          <h2 className="section-title">Da rivedere ({wrong.length})</h2>
          <div className="flex flex-col gap-2">
            {wrong.map(({ q, i, r }) => (
              <button key={q.id} className="card card-hover text-left flex items-center gap-3" onClick={() => onReview(i)}>
                <span className={`qdot big ${r ? 'ko' : ''}`} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[14px]">
                    {i + 1}. {q.text}
                  </span>
                  <span className="text-[12px] opacity-55">{r ? (q.type === 'open' ? `${Math.round((r.score ?? 0) * 100)}%` : 'Risposta errata') : 'Senza risposta'} · vedi spiegazione</span>
                </span>
                <ArrowRight size={16} className="opacity-40" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Permette di correggere a mano eventuali errori di estrazione (testo, opzioni, risposta giusta). */
function QuizEditor({ open, onClose, quiz }: { open: boolean; onClose: () => void; quiz: Quiz }) {
  const [qs, setQs] = useState<Question[]>(quiz.questions)
  const [title, setTitle] = useState(quiz.title)
  useEffect(() => {
    if (open) {
      setQs(quiz.questions)
      setTitle(quiz.title)
    }
  }, [open, quiz])
  const upd = (id: string, p: Partial<Question>) => setQs((l) => l.map((q) => (q.id === id ? { ...q, ...p } : q)))
  const save = async () => {
    await put<Quiz>('quizzes', { ...quiz, title, questions: qs })
    toast('Quiz aggiornato')
    onClose()
  }
  const count = useMemo(() => qs.length, [qs])
  return (
    <Modal open={open} onClose={onClose} title={`Controlla le domande (${count})`} wide>
      <input className="field mb-3" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="max-h-[60vh] overflow-y-auto flex flex-col gap-3 pr-1">
        {qs.map((q, n) => (
          <div key={q.id} className="card !p-3">
            <div className="flex gap-2 mb-2 items-center">
              <b className="text-[13px]">#{n + 1}</b>
              <select className="field sel-sm" value={q.type} onChange={(e) => upd(q.id, { type: e.target.value as Question['type'], options: e.target.value === 'open' ? [] : q.options.length ? q.options : ['', ''] })}>
                <option value="single">Scelta singola</option>
                <option value="multi">Risposta multipla</option>
                <option value="truefalse">Vero/Falso</option>
                <option value="open">Aperta</option>
              </select>
              <span className="flex-1" />
              <button className="icon-btn sm danger" onClick={() => setQs((l) => l.filter((x) => x.id !== q.id))}>
                <Trash2 size={14} />
              </button>
            </div>
            <textarea className="field text-[13.5px]" rows={2} value={q.text} onChange={(e) => upd(q.id, { text: e.target.value })} />
            {q.type !== 'open' && (
              <div className="flex flex-col gap-1.5 mt-2">
                {q.options.map((o, k) => (
                  <div key={k} className="flex gap-2 items-center">
                    <input
                      type={q.type === 'multi' ? 'checkbox' : 'radio'}
                      name={q.id}
                      checked={!!q.correct?.includes(k)}
                      title="Risposta corretta"
                      onChange={(e) =>
                        upd(q.id, {
                          correct: q.type === 'multi' ? (e.target.checked ? [...(q.correct ?? []), k] : (q.correct ?? []).filter((x) => x !== k)) : [k],
                          solutionFromPdf: true,
                        })
                      }
                    />
                    <input className="field py-1 text-[13px]" value={o} onChange={(e) => upd(q.id, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} />
                  </div>
                ))}
              </div>
            )}
            {q.type === 'open' && (
              <textarea className="field text-[13px] mt-2" rows={2} placeholder="Soluzione (facoltativa)" value={q.solution ?? ''} onChange={(e) => upd(q.id, { solution: e.target.value || null, solutionFromPdf: !!e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn" onClick={onClose}>
          Annulla
        </button>
        <button className="btn btn-primary" onClick={save}>
          <Save size={15} /> Salva
        </button>
      </div>
    </Modal>
  )
}
