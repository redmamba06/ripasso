# Ripasso

App (PWA installabile su Mac/PC, iPad, iPhone) per ripassare le slide dei corsi: appunti collegati alle slide, riassunto completo del corso, quiz dagli esami passati e tutor AI (Groq).

## Avvio in locale

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build di produzione in dist/
```

La chiave Groq per lo sviluppo sta in `.env.local` (`VITE_GROQ_KEY=...`, file ignorato da git). **Non viene inclusa nella build pubblicata**: sugli altri dispositivi va incollata in *Impostazioni → Intelligenza artificiale*, oppure arriva da sola dopo l'accesso al cloud (viene salvata nel proprio account).

## Sincronizzazione tra dispositivi (Supabase)

1. Crea un progetto gratuito su supabase.com.
2. SQL Editor → incolla ed esegui `supabase/schema.sql` (tabella `records` con RLS, realtime, bucket `blobs` per PDF e immagini).
3. Authentication → Providers → Email: attivo (per comodità si può disattivare “Confirm email”).
4. Nell'app: *Impostazioni → Sincronizzazione* → incolla Project URL e chiave `anon` → Registrati / Accedi.

Funzionamento: i dati vivono in IndexedDB (l'app funziona offline) e si sincronizzano con Supabase con last-write-wins per record; PDF e ritagli vanno nello storage e vengono scaricati sugli altri dispositivi quando servono.

## Struttura

- `src/lib/db.ts` – database locale (Dexie) e modello dati
- `src/lib/sync.ts` – sincronizzazione Supabase (dati + file)
- `src/lib/groq.ts` – client Groq (streaming, JSON, limite di token/minuto del piano gratuito)
- `src/lib/quiz.ts` – estrazione domande dai PDF d'esame e correzione
- `src/editor/` – editor stile Notion (TipTap): menu `/`, codice stile IDE, terminale Linux, riquadri, collegamenti alle slide
- `src/pages/` – Home, Corso (unità, file, esame, quiz, riassunto), Unità (slide + appunti), Quiz, Riassunto, Impostazioni
