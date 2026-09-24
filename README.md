# Ripasso

App (PWA installabile su Mac/PC, iPad, iPhone) per ripassare le slide dei corsi: appunti collegati alle slide, riassunto completo del corso, quiz dagli esami passati e tutor AI (Groq).

## Avvio in locale

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build di produzione in dist/
```

La chiave Groq per lo sviluppo sta in `.env.local` (`VITE_GROQ_KEY=...`, ignorato da git) e **non finisce nella build**.

## Cloud (Supabase) e AI

L'app è già collegata al progetto Supabase `ufcfpxqfhvbnpunfzrea` (URL e chiave anon pubblica in `src/lib/settings.ts`): basta registrarsi/accedere in *Impostazioni*.

- Dati: tabella `records` con RLS (ognuno vede solo i propri), realtime tra dispositivi; PDF e immagini nel bucket privato `blobs`. Schema in `supabase/schema.sql`.
- AI: la funzione `supabase/functions/groq` fa da ponte verso Groq. La chiave è nel segreto `GROQ_API_KEY` e risponde solo alle email in `ALLOWED_EMAILS` → la chiave non è mai nel browser né nel repository. Una chiave personale inserita in Impostazioni ha la precedenza (solo su quel dispositivo).

## Pubblicazione

```bash
npm run build && cd dist && touch .nojekyll && git init -b gh-pages && git add -A && git commit -m Deploy && git push -f https://github.com/redmamba06/ripasso.git gh-pages
```

## Struttura

- `src/lib/db.ts` – database locale (Dexie) e modello dati
- `src/lib/sync.ts` – sincronizzazione Supabase (dati + file)
- `src/lib/groq.ts` – client Groq (streaming, JSON, limite di token/minuto del piano gratuito)
- `src/lib/quiz.ts` – estrazione domande dai PDF d'esame e correzione
- `src/editor/` – editor stile Notion (TipTap): menu `/`, codice stile IDE, terminale Linux, riquadri, collegamenti alle slide
- `src/lib/shortcuts.ts` – scorciatoie da tastiera personalizzabili (⌘/ per l'elenco)
- `src/pages/` – Home, Corso (unità, file, esame, quiz, riassunto), Unità (slide + appunti), Quiz, Riassunto, Impostazioni
