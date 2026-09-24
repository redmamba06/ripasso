import { chat, chatJSON, type GMsg } from './groq'
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
    onP(`${label}: leggo pagina ${p}/${doc.numPages}`)
    let text = await pageText(doc, p)
    if (text.replace(/\s/g, '').length < 40) {
      onP(`${label}: pagina ${p} scansionata, la leggo con l’AI…`)
      try {
        const img = await pageImage(doc, p, 1200)
        text = await chat(
          [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Trascrivi FEDELMENTE tutto il testo di questa pagina (è un esame o un quiz universitario). Mantieni numerazione, domande e opzioni (a, b, c…). Se una opzione è evidenziata, cerchiata, spuntata o marcata come corretta scrivi [CORRETTA] accanto. Non aggiungere nulla.',
                },
                { type: 'image_url', image_url: { url: img } },
              ],
            },
          ],
          { model: settings().visionModel, maxTokens: 2500, temperature: 0, onWait: (s) => onP(`Attendo il limite gratuito di Groq (${s}s)…`) },
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

const render = (pages: PageT[]) => pages.map((p) => `=== PAGINA ${p.page} ===\n${p.text}`).join('\n\n')

const EXTRACT_RULES = `Sei un estrattore di domande d'esame. Ricevi il testo (estratto da PDF) di un esame, quiz o simulazione universitaria.
REGOLE FONDAMENTALI:
- Estrai SOLO le domande realmente presenti nel testo. NON inventare, NON riformulare, NON aggiungere domande.
- Copia testo della domanda e delle opzioni in modo fedele (puoi solo sistemare a-capo e spazi spezzati dal PDF). Mantieni formule/codice.
- "type": "single" (scelta multipla con una risposta), "multi" (più risposte corrette possibili, es. "seleziona tutte"), "truefalse" (vero/falso: options = ["Vero","Falso"]), "open" (risposta aperta, esercizio, calcolo, completamento, codice).
- "options": solo le opzioni presenti, SENZA la lettera iniziale (es. "a) " va tolto). Per "open" usa [].
- "correct": indici (da 0) delle opzioni corrette SOLO se il testo le indica chiaramente (es. [CORRETTA], asterisco, "Risposta: b", griglia di soluzioni). Altrimenti null.
- "solution": testo della soluzione/svolgimento se presente nel testo, altrimenti null. Non scrivere soluzioni tue.
- "number": numero della domanda come appare (stringa), "page": numero di pagina, "points": punteggio se indicato.
- Se una domanda ha sotto-punti (a, b, c) di tipo aperto, puoi tenerla come un'unica domanda "open".
- Ignora intestazioni, istruzioni generali, nome/matricola.
Rispondi SOLO con JSON: {"questions":[{"number":"1","type":"single","text":"...","options":["..."],"correct":[1]|null,"solution":null,"points":null,"page":1}]}`

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
  if (type === 'truefalse' && options.length < 2) options = ['Vero', 'Falso']
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
  const wait = (s: number) => onP(`Attendo il limite gratuito di Groq (${s}s)…`)
  for (const [fi, fid] of examFileIds.entries()) {
    const pages = await extractPages(fid, onP, `File ${fi + 1}/${examFileIds.length}`)
    const chunks = chunkPages(pages)
    for (const [ci, ch] of chunks.entries()) {
      onP(`Estraggo le domande (parte ${ci + 1}/${chunks.length})…`, (ci + 1) / chunks.length)
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
    const pages = await extractPages(sid, onP, `Soluzioni ${si + 1}/${solutionFileIds.length}`)
    const chunks = chunkPages(pages, 5000)
    for (const [ci, ch] of chunks.entries()) {
      onP(`Abbino le soluzioni (parte ${ci + 1}/${chunks.length})…`)
      const list = questions.map((q, i) => ({ i, n: q.number, t: q.text.slice(0, 90), o: q.options.length ? q.options.map((o) => o.slice(0, 40)) : undefined }))
      // spezza la lista se troppo lunga
      for (let k = 0; k < list.length; k += 25) {
        const part = list.slice(k, k + 25)
        const j = await chatJSON<{ answers: { i: number; correct?: number[] | null; solution?: string | null }[] }>(
          [
            {
              role: 'system',
              content: `Ricevi un elenco di domande d'esame (indice i, numero n, inizio testo t, opzioni o) e il testo di un documento di SOLUZIONI.
Per ogni domanda la cui soluzione compare nel documento, restituisci l'indice i, gli indici (da 0) delle opzioni corrette "correct" (solo per domande con opzioni) e "solution" con il testo della soluzione/svolgimento copiato fedelmente dal documento (per le aperte).
NON inventare: se una soluzione non c'è, non includere quella domanda.
Rispondi SOLO JSON: {"answers":[{"i":0,"correct":[2],"solution":null}]}`,
            },
            { role: 'user', content: `DOMANDE:\n${JSON.stringify(part)}\n\nSOLUZIONI:\n${render(ch)}` },
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
    ? `Domanda d'esame del corso "${courseName}":\n${qText(q)}\n\nRisposta corretta (dal PDF): ${known.map(letter).join(', ')}\nRisposta dello studente: ${given.length ? given.map(letter).join(', ') : 'nessuna'}\n\nSpiega in modo breve e chiaro PERCHÉ la risposta corretta è quella${given.length && gradeChoice(q, given) === false ? " e perché quella scelta dallo studente è sbagliata" : ''}. Max 120 parole, Markdown.`
    : `Domanda d'esame del corso "${courseName}" (il PDF non contiene la soluzione):\n${qText(q)}\n\nRisposta dello studente: ${given.length ? given.map(letter).join(', ') : 'nessuna'}\n\nIndica quale opzione è corretta e spiega perché in max 120 parole (Markdown). Nella PRIMA riga scrivi solo: RISPOSTA: <lettere separate da virgola>`
  const out = await chat([{ role: 'user', content: prompt }], { maxTokens: 1500, temperature: 0.2, reasoning: 'medium' })
  if (known) return { text: out }
  const m = out.match(/RISPOSTA:\s*([a-z ,]+)/i)
  const aiCorrect = m ? m[1].split(/[ ,]+/).filter(Boolean).map((l) => l.toLowerCase().charCodeAt(0) - 97).filter((n) => n >= 0 && n < q.options.length) : undefined
  return { text: out.replace(/^.*RISPOSTA:.*\n?/i, '').trim(), aiCorrect }
}

/** Valuta una risposta aperta confrontandola con la soluzione del PDF (se c'è). */
export async function gradeOpen(q: Question, answer: string, courseName: string): Promise<AnswerResult> {
  const sys = `Sei un docente che corregge un esame universitario del corso "${courseName}". Correggi in modo onesto ma costruttivo, in italiano.
Rispondi SOLO JSON: {"score": numero da 0 a 1, "verdict": "corretta"|"parziale"|"errata", "feedback": "Markdown: cosa va bene, cosa manca o è sbagliato, e la risposta corretta spiegata in breve"}`
  const user = `DOMANDA:\n${q.text}\n\n${q.solution ? `SOLUZIONE UFFICIALE (dal PDF):\n${q.solution}\n\n` : 'La soluzione ufficiale NON è disponibile: valuta con le tue conoscenze e dillo nel feedback.\n\n'}RISPOSTA DELLO STUDENTE:\n${answer || '(vuota)'}`
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
        content: `Analizzi gli errori di uno studente nelle simulazioni d'esame del corso "${courseName}".
Raggruppa le domande sbagliate in 2-6 argomenti deboli, ordinati per importanza (numero di errori).
Per ogni argomento indica quali unità del corso ripassare (usa ESATTAMENTE i titoli forniti, solo se pertinenti) e un consiglio pratico breve (max 25 parole).
Rispondi SOLO JSON: {"topics":[{"topic":"...","errors":3,"units":["titolo unità"],"tip":"..."}]}`,
      },
      {
        role: 'user',
        content: `UNITÀ DEL CORSO:\n${units.map((u) => '- ' + u.title).join('\n')}\n\nDOMANDE SBAGLIATE (con numero di volte):\n${list.map((w) => `(${w.n}x) ${w.text}`).join('\n')}`,
      },
    ],
    { maxTokens: 2000, temperature: 0.2 },
  )
  return (j.topics ?? []).filter((t) => t.topic).slice(0, 6)
}
