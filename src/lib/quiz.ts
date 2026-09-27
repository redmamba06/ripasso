import { chat, chatJSON, aiLang, type GMsg } from './groq'
import { loadPdf, pageText, pageImage } from './pdf'
import { settings } from './settings'
import { uid, type Question, type QType, type AnswerResult, type Attempt, type Quiz, type Unit, type WeakTopic } from './db'

export type Progress = (msg: string, frac?: number) => void

interface PageT {
  fileId: string
  page: number
  text: string
}

/** Estrae il testo di tutte le pagine; le pagine scansionate passano dal modello con visione. */
export async function extractPages(fileId: string, onP: Progress, label: string): Promise<PageT[]> {
  const doc = await loadPdf(fileId)
  const out: PageT[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    onP(`${label}: reading page ${p}/${doc.numPages}`)
    let text = await pageText(doc, p)
    if (text.replace(/\s/g, '').length < 40) {
      onP(`${label}: page ${p} is scanned, reading it with the AI…`)
      try {
        const img = await pageImage(doc, p, 1200)
        text = await chat(
          [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Transcribe ALL the text of this page FAITHFULLY, in its original language (it is a university exam or quiz). Keep numbering, questions and options (a, b, c…). If an option is highlighted, circled, ticked or marked as correct, write [CORRECT] next to it. Do not add anything.',
                },
                { type: 'image_url', image_url: { url: img } },
              ],
            },
          ],
          { model: settings().visionModel, maxTokens: 2500, temperature: 0, onWait: (s) => onP(`Waiting for Groq’s free-plan limit (${s}s)…`) },
        )
      } catch (e) {
        console.warn('ocr', e)
      }
    }
    out.push({ fileId, page: p, text })
  }
  return out
}

function chunkPages(pages: PageT[], max = 6500): PageT[][] {
  const chunks: PageT[][] = []
  let cur: PageT[] = []
  let len = 0
  for (const pg of pages) {
    if (pg.text.length > max) {
      if (cur.length) chunks.push(cur)
      cur = []
      len = 0
      for (let i = 0; i < pg.text.length; i += max) chunks.push([{ ...pg, text: pg.text.slice(Math.max(0, i - 300), i + max) }])
      continue
    }
    if (len + pg.text.length > max && cur.length) {
      chunks.push(cur)
      cur = []
      len = 0
    }
    cur.push(pg)
    len += pg.text.length
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

const render = (pages: PageT[]) => pages.map((p) => `=== PAGE ${p.page} ===\n${p.text}`).join('\n\n')

const EXTRACT_RULES = `You extract exam questions. You receive the text (extracted from a PDF) of a university exam, quiz or mock exam.
CORE RULES:
- Extract ONLY the questions actually present in the text. Do NOT invent, rephrase or add questions.
- Copy question text and options faithfully, in their ORIGINAL language (you may only fix line breaks and spacing broken by the PDF). Keep formulas/code.
- "type": "single" (multiple choice, one answer), "multi" (several correct answers possible, e.g. "select all"), "truefalse" (true/false: options = the two options as written, e.g. ["True","False"] or ["Vero","Falso"]), "open" (open answer, exercise, calculation, fill-in, code).
- "options": only the options present, WITHOUT the leading letter (e.g. "a) " is removed). For "open" use [].
- "correct": indexes (from 0) of the correct options ONLY if the text clearly marks them (e.g. [CORRECT], asterisk, "Answer: b", answer grid). Otherwise null.
- "solution": text of the solution/worked answer if present in the text, otherwise null. Never write your own solutions.
- "number": question number as it appears (string), "page": page number, "points": score if stated.
- If a question has open sub-parts (a, b, c) you may keep it as a single "open" question.
- Ignore headers, general instructions, name/student ID.
Reply ONLY with JSON: {"questions":[{"number":"1","type":"single","text":"...","options":["..."],"correct":[1]|null,"solution":null,"points":null,"page":1}]}`

interface RawQ {
  number?: string | number
  type?: string
  text?: string
  options?: string[]
  correct?: number[] | number | null
  solution?: string | null
  points?: string | number | null
  page?: number
}

function normalize(r: RawQ, fileId: string): Question | null {
  if (!r.text || !String(r.text).trim()) return null
  let type = (['single', 'multi', 'truefalse', 'open'].includes(r.type ?? '') ? r.type : 'open') as QType
  let options = Array.isArray(r.options) ? r.options.map((o) => String(o).trim()).filter(Boolean) : []
  if (type === 'truefalse' && options.length < 2) options = ['True', 'False']
  if ((type === 'single' || type === 'multi') && options.length < 2) type = 'open'
  if (type === 'open') options = []
  let correct: number[] | null = r.correct == null ? null : Array.isArray(r.correct) ? r.correct : [r.correct]
  if (correct) correct = correct.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < options.length)
  if (correct && !correct.length) correct = null
  return {
    id: uid(),
    number: r.number != null ? String(r.number) : undefined,
    type,
    text: String(r.text).trim(),
    options,
    correct: type === 'open' ? null : correct,
    solution: r.solution ? String(r.solution).trim() : null,
    solutionFromPdf: !!(correct || r.solution),
    points: r.points != null ? String(r.points) : undefined,
    page: r.page,
    fileId,
  }
}

export async function extractQuiz(examFileIds: string[], solutionFileIds: string[], onP: Progress): Promise<Question[]> {
  const questions: Question[] = []
  const wait = (s: number) => onP(`Waiting for Groq’s free-plan limit (${s}s)…`)
  for (const [fi, fid] of examFileIds.entries()) {
    const pages = await extractPages(fid, onP, `File ${fi + 1}/${examFileIds.length}`)
    const chunks = chunkPages(pages)
    for (const [ci, ch] of chunks.entries()) {
      onP(`Extracting questions (part ${ci + 1}/${chunks.length})…`, (ci + 1) / chunks.length)
      const msgs: GMsg[] = [
        { role: 'system', content: EXTRACT_RULES },
        { role: 'user', content: render(ch) },
      ]
      const j = await chatJSON<{ questions: RawQ[] }>(msgs, { maxTokens: 4200, temperature: 0, reasoning: 'low', onWait: wait })
      for (const r of j.questions ?? []) {
        const q = normalize(r, fid)
        if (q && !questions.some((x) => x.text === q.text)) questions.push(q)
      }
    }
  }

  // soluzioni in file separati
  for (const [si, sid] of solutionFileIds.entries()) {
    const pages = await extractPages(sid, onP, `Solutions ${si + 1}/${solutionFileIds.length}`)
    const chunks = chunkPages(pages, 5000)
    for (const [ci, ch] of chunks.entries()) {
      onP(`Matching solutions (part ${ci + 1}/${chunks.length})…`)
      const list = questions.map((q, i) => ({ i, n: q.number, t: q.text.slice(0, 90), o: q.options.length ? q.options.map((o) => o.slice(0, 40)) : undefined }))
      // spezza la lista se troppo lunga
      for (let k = 0; k < list.length; k += 25) {
        const part = list.slice(k, k + 25)
        const j = await chatJSON<{ answers: { i: number; correct?: number[] | null; solution?: string | null }[] }>(
          [
            {
              role: 'system',
              content: `You receive a list of exam questions (index i, number n, start of text t, options o) and the text of a SOLUTIONS document.
For every question whose solution appears in the document, return its index i, the indexes (from 0) of the correct options "correct" (only for questions with options) and "solution" with the solution/worked answer copied faithfully from the document (for open questions).
Do NOT invent: if a solution is missing, leave that question out.
Reply ONLY with JSON: {"answers":[{"i":0,"correct":[2],"solution":null}]}`,
            },
            { role: 'user', content: `QUESTIONS:\n${JSON.stringify(part)}\n\nSOLUTIONS:\n${render(ch)}` },
          ],
          { maxTokens: 3000, temperature: 0, onWait: wait },
        )
        for (const a of j.answers ?? []) {
          const q = questions[a.i]
          if (!q) continue
          if (a.correct && q.options.length) {
            const c = a.correct.map(Number).filter((n) => n >= 0 && n < q.options.length)
            if (c.length) {
              q.correct = c
              if (q.type === 'single' && c.length > 1) q.type = 'multi'
            }
          }
          if (a.solution) q.solution = String(a.solution).trim()
          if (a.correct || a.solution) q.solutionFromPdf = true
        }
      }
    }
  }
  return questions
}

// ---------------- correzione ----------------

export function gradeChoice(q: Question, given: number[]): boolean | null {
  if (!q.correct) return null
  const a = [...given].sort().join(',')
  const b = [...q.correct].sort().join(',')
  return a === b
}

const letter = (i: number) => String.fromCharCode(97 + i)
const qText = (q: Question) => `${q.text}${q.options.length ? '\n' + q.options.map((o, i) => `${letter(i)}) ${o}`).join('\n') : ''}`

/** Spiegazione per una domanda a scelta: perché la risposta corretta è quella. */
export async function explainChoice(q: Question, given: number[], courseName: string): Promise<{ text: string; aiCorrect?: number[] }> {
  const known = q.correct
  const prompt = known
    ? `Exam question from the course "${courseName}":\n${qText(q)}\n\nCorrect answer (from the PDF): ${known.map(letter).join(', ')}\nStudent's answer: ${given.length ? given.map(letter).join(', ') : 'none'}\n\nExplain briefly and clearly WHY that is the correct answer${given.length && gradeChoice(q, given) === false ? " and why the student's choice is wrong" : ''}. Max 120 words, Markdown, in ${aiLang()}.`
    : `Exam question from the course "${courseName}" (the PDF does not contain the solution):\n${qText(q)}\n\nStudent's answer: ${given.length ? given.map(letter).join(', ') : 'none'}\n\nSay which option is correct and explain why in max 120 words (Markdown, in ${aiLang()}). On the FIRST line write only: ANSWER: <letters separated by commas>`
  const out = await chat([{ role: 'user', content: prompt }], { maxTokens: 1500, temperature: 0.2, reasoning: 'medium' })
  if (known) return { text: out }
  const m = out.match(/(?:ANSWER|RISPOSTA):\s*([a-z ,]+)/i)
  const aiCorrect = m ? m[1].split(/[ ,]+/).filter(Boolean).map((l) => l.toLowerCase().charCodeAt(0) - 97).filter((n) => n >= 0 && n < q.options.length) : undefined
  return { text: out.replace(/^.*(?:ANSWER|RISPOSTA):.*\n?/i, '').trim(), aiCorrect }
}

/** Valuta una risposta aperta confrontandola con la soluzione del PDF (se c'è). */
export async function gradeOpen(q: Question, answer: string, courseName: string): Promise<AnswerResult> {
  const sys = `You are a professor grading a university exam of the course "${courseName}". Grade honestly but constructively. Write the feedback in ${aiLang()}.
Reply ONLY with JSON: {"score": number from 0 to 1, "verdict": "correct"|"partial"|"wrong", "feedback": "Markdown: what is good, what is missing or wrong, and the correct answer briefly explained"}`
  const user = `QUESTION:\n${q.text}\n\n${q.solution ? `OFFICIAL SOLUTION (from the PDF):\n${q.solution}\n\n` : 'The official solution is NOT available: grade using your own knowledge and say so in the feedback.\n\n'}STUDENT'S ANSWER:\n${answer || '(empty)'}`
  const j = await chatJSON<{ score: number; verdict: string; feedback: string }>(
    [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    { maxTokens: 2200, temperature: 0.2, reasoning: 'medium' },
  )
  const score = Math.max(0, Math.min(1, Number(j.score) || 0))
  return { given: answer, correct: score >= 0.6, score, feedback: j.feedback }
}

// ---------------- punti deboli ----------------


/** Raccoglie le domande sbagliate (o parziali) di tutti i tentativi e chiede all'AI di raggrupparle per argomento. */
export async function analyzeWeak(courseName: string, units: Unit[], quizzes: Quiz[], attempts: Attempt[]): Promise<WeakTopic[]> {
  const wrong = new Map<string, { text: string; n: number }>()
  for (const a of attempts) {
    if (!a.finishedAt) continue
    const q = quizzes.find((x) => x.id === a.quizId)
    if (!q) continue
    for (const qq of q.questions) {
      const r = a.answers[qq.id]
      const bad = !r || r.correct === false || (qq.type === 'open' && (r.score ?? 0) < 0.6)
      if (!bad) continue
      const cur = wrong.get(qq.id) ?? { text: qq.text.slice(0, 220), n: 0 }
      cur.n++
      wrong.set(qq.id, cur)
    }
  }
  if (!wrong.size) return []
  const list = [...wrong.values()].sort((a, b) => b.n - a.n).slice(0, 40)
  const j = await chatJSON<{ topics: WeakTopic[] }>(
    [
      {
        role: 'system',
        content: `You analyse a student's mistakes in the mock exams of the course "${courseName}".
Group the wrong questions into 2-6 weak topics, ordered by importance (number of mistakes).
For each topic say which course units to revise (use EXACTLY the titles given, only if relevant) and a short practical tip (max 25 words). Write topics and tips in ${aiLang()}.
Reply ONLY with JSON: {"topics":[{"topic":"...","errors":3,"units":["unit title"],"tip":"..."}]}`,
      },
      {
        role: 'user',
        content: `COURSE UNITS:\n${units.map((u) => '- ' + u.title).join('\n')}\n\nWRONG QUESTIONS (with number of times):\n${list.map((w) => `(${w.n}x) ${w.text}`).join('\n')}`,
      },
    ],
    { maxTokens: 2000, temperature: 0.2 },
  )
  return (j.topics ?? []).filter((t) => t.topic).slice(0, 6)
}
