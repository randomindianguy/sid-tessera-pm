# Cutover Trust Gate

An independent check for AI-run system migrations, plus the case for why it matters.
React + Vite single-page app with one serverless function that proxies an Anthropic
call (for the live "second opinion" button) so the API key stays server-side.

## Run locally

```bash
npm install
cp .env.example .env          # then paste your real ANTHROPIC_API_KEY into .env
npm run dev                   # http://localhost:5173
```

The live "second opinion" button calls `/api/second-opinion`. Plain `npm run dev`
serves the app but not the serverless function, so that one button falls back to a
written answer. To exercise the real function locally, use the Vercel CLI:

```bash
npm i -g vercel
vercel dev                    # runs the SPA and the /api function together
```

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: New Project, import the repo. Vercel auto-detects Vite, no config needed.
3. Project Settings > Environment Variables, add:
   - `ANTHROPIC_API_KEY` = your key (required for the live button)
   - `ANTHROPIC_MODEL` = `claude-sonnet-4-6` (optional; this is the default)
4. Deploy.

Or from the CLI:

```bash
vercel
vercel env add ANTHROPIC_API_KEY      # paste key when prompted
vercel --prod
```

If `ANTHROPIC_API_KEY` is not set, the app still works end to end. The second-opinion
button returns a written fallback instead of a live model answer, so a demo never
breaks.

## Two things to set before sharing

- **Brand color.** In `src/App.jsx`, find the `BRAND COLORS` comment near the top of the
  `CSS` string and replace `--accent` and `--accent-soft` with Tessera's exact hex
  (color-pick from tesseralabs.ai). Everything keys off those two.
- **The "Why me" paragraph** (in the "Why this matters to Tessera" tab) is first person.
  Read it as yourself and adjust anything that overclaims.

## What's here

```
index.html              app shell
src/main.jsx            React entry
src/App.jsx             the whole app (tool + case), all styling inline
api/second-opinion.js   Vercel serverless proxy to Anthropic (key stays server-side)
vite.config.js          Vite + React
.env.example            copy to .env for local dev
```

Prototype on synthetic data. An independent concept, not affiliated with or endorsed
by Tessera Labs.
