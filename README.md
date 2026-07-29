# Strattam Expert Interview Sourcing Tool

An internal web tool that automates sourcing expert-interview candidates for commercial due diligence — an alternative or supplement to GLG-style expert networks. An analyst enters a target company (plus an optional thesis and/or diligence questions), and gets back a ranked, tiered list of real, named interview candidates with sourcing citations, mapped to the diligence questions, plus a coverage-gap report and an Excel export.

See [`docs/01-overview.md`](docs/01-overview.md) for what it does and how it works end to end, and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for deploying it (GitHub + Render + Vercel, same pattern as the Thesis Fit Scorer).

## Repo layout

```
backend/    Express + TypeScript. Always-on server — owns every paid API key
            (Anthropic, Firecrawl, People Data Labs) and the whole pipeline.
frontend/   Next.js + TypeScript. Thin UI — no paid keys, no pipeline logic.
docs/       Overview + deployment docs.
```

## Local development

**Backend** (from `backend/`):

```
cp .env.example .env        # fill in ANTHROPIC_API_KEY, FIRECRAWL_API_KEY, PDL_API_KEY, ACCESS_CODE
npm install
npm run dev                 # http://localhost:8787
```

**Frontend** (from `frontend/`), in a second terminal:

```
cp .env.example .env.local  # set NEXT_PUBLIC_API_BASE=http://localhost:8787
npm install
npm run dev                 # http://localhost:3000
```

Log in with whatever you set `ACCESS_CODE` to on the backend.

## Why two separate apps instead of one

The pipeline makes several sequential and parallel calls to three external APIs (Claude, Firecrawl, People Data Labs) per run, and a real run takes anywhere from 20 seconds to several minutes. Any hosting approach that runs this inside a single request-response cycle bound by a short serverless function duration limit (e.g. a 60-second cap) will eventually time out, no matter how much the prompts are optimized. The backend is therefore a plain always-on server process — a request can run as long as it genuinely needs. The frontend stays a thin, stateless UI. See `docs/01-overview.md` for the full architecture rationale.

## Status

Code-complete and type-checked (`tsc --noEmit` and `next build` both pass clean) but **not yet deployed or live-tested end to end** — the sandbox this was built in blocks outbound calls to `api.firecrawl.dev` and `api.peopledatalabs.com`, and the Anthropic key supplied during the build returned `401 Unauthorized` (worth double-checking/rotating). Before relying on this for a real deal, run it locally or on Render with working keys and sanity-check one full pass on a real company.
