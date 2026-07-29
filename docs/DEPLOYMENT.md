# Deployment

Same proven pattern as the Thesis Fit Scorer: GitHub for source control, Render for the always-on backend, Vercel for the frontend. If either provider's build pipeline turns out to be unreliable for this app shape, it's entirely reasonable to run both halves on the same reliable provider instead (e.g. two separate Render web services) — what matters is that the backend is an always-on process, not which host it lands on.

## 1. GitHub

1. Create a repo (e.g. `strattam-expert-sourcer`) under a Strattam-owned GitHub org, not a personal account, so access survives anyone leaving.
2. Push this folder's contents — `backend/` and `frontend/` as two directories in one repo (or two repos, if you'd rather deploy them fully independently; either works since they only talk over HTTP).
3. Confirm `.gitignore` in both `backend/` and `frontend/` excludes `node_modules`, build output (`dist/`, `.next/`), and `.env*` — check this before the first push. Never commit real API keys.

## 2. Backend → Render

1. New Web Service on Render, pointed at the repo, root directory `backend/`.
2. Build command: `npm install && npm run build`. Start command: `npm start` (or use the included `Procfile`).
3. Choose the Starter plan (~$7/mo) with a small persistent disk mounted at the path in `DB_PATH` (default `./data/sourcer.db`) so the SQLite cache and run history survive restarts/redeploys.
4. Environment variables (see `backend/.env.example` for the full list with comments):
   - `ANTHROPIC_API_KEY`
   - `FIRECRAWL_API_KEY`
   - `PDL_API_KEY`
   - `GRATA_API_KEY` — optional. Requires your Grata account to be activated for API access by a Grata CSM/AE first (a plain seat login isn't enough). Leave empty to skip Grata entirely; the pipeline degrades gracefully.
   - `RAYLU_API_KEY` — optional, currently has no effect (see `backend/src/clients/raylu.ts` — not implemented yet pending a real API contract from Raylu).
   - `ACCESS_CODE` — pick a real shared code; do not leave empty in production.
   - `CORS_ORIGINS` — set to the deployed Vercel URL once you have it (comma-separated if there's more than one, e.g. a staging + prod frontend).
   - `PORT` — Render sets this automatically; the app reads `process.env.PORT`.
   - `DB_PATH`, `CACHE_TTL_DAYS`, `PDL_CONCURRENCY`, `PDL_COST_PER_RECORD_USD`, `FIRECRAWL_COST_PER_CALL_USD` — defaults are reasonable; adjust `PDL_COST_PER_RECORD_USD` and `FIRECRAWL_COST_PER_CALL_USD` to match the firm's actual contracted rates once known.
5. Once deployed, hit `GET /health` and `GET /` on the Render URL to confirm it's up and which keys are configured.

## 3. Frontend → Vercel

1. New Project on Vercel, pointed at the repo, root directory `frontend/`.
2. Framework preset: Next.js (auto-detected).
3. Environment variable: `NEXT_PUBLIC_API_BASE` = the Render backend's URL (no trailing slash).
4. Deploy. Vercel's free tier is sufficient — this frontend does no heavy lifting.
5. Once both are live, go back to the Render backend's `CORS_ORIGINS` and set it to this exact Vercel URL (not a wildcard), then redeploy the backend so the restriction takes effect.

## 4. First real run — things to check before trusting it with a live deal

The build was done in a sandboxed environment that couldn't reach `api.firecrawl.dev` or `api.peopledatalabs.com`, and the Anthropic key supplied during the build returned `401 Unauthorized`. None of the three external integrations have been live-tested end to end. Before relying on this for a real deal:

1. Confirm all three keys are valid (the backend's `GET /` response reports which are configured, but not whether they're *valid* — the first real run will surface an auth error immediately if one is bad).
2. Run one full pass on a real, known company and read the output closely — check that the company profile's citations are real URLs, that PDL candidates look plausible, that no current employee of the target slipped through the compliance filter, and that the coverage-gap report makes sense.
3. Check the itemized cost breakdown after that first run and sanity-check `PDL_COST_PER_RECORD_USD` / `FIRECRAWL_COST_PER_CALL_USD` against the firm's actual PDL and Firecrawl plans — the defaults are estimates, not the firm's contracted rates.
4. Rotate the Anthropic and PDL keys used during this build session before going live, since they were shared in a chat conversation rather than set directly in Render's environment variables.
5. `backend/src/clients/grata.ts` was written against Grata's public marketing/API-overview pages, not their full account-scoped API reference (which requires a logged-in session to view). The base host and the enrichment path are reasonably confident; the exact similar-companies path, the auth header format (defaults to `Authorization: Bearer`), and the field name(s) for executive/board contacts on the response are not independently verified — confirm all three against your actual Grata API docs once your account is API-activated, and adjust the single `authHeaders()` function and the field-name fallbacks in `grataEnrichCompany` if they differ.
