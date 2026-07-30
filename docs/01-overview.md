# 01 — System Overview

## What it is

The Expert Interview Sourcing Tool is an internal web tool that finds real, named expert-interview candidates for commercial due diligence. A user enters a target company, optionally confirms which real company they mean, optionally adds an investment thesis and/or specific diligence questions, and picks a Claude model. The tool then researches the company, proposes expertise areas tailored to that company, searches for real people who match those areas (via a licensed people-data API and public web research — never invented), removes anyone who currently works at or sits on the board of the target company, scores and tiers the survivors, maps them to the diligence questions, and flags coverage gaps. Results export to Excel.

It exists to make expert-network-style sourcing faster and cheaper than a GLG-style engagement, while keeping every fact traceable to a real citation.

## How the team accesses it

- **URL:** set at deploy time (e.g. `https://strattam-expert-sourcer.vercel.app`) — not yet deployed as of this writing.
- **Access code:** a single shared code, set via the backend's `ACCESS_CODE` env var. No per-user accounts in v1. The code is the only gate, and it's the only thing preventing outsiders from spending the firm's Anthropic, Firecrawl, and People Data Labs credits. Rotate it if it's ever shared too widely.
- **Who can use it:** anyone at the firm with the URL and the access code.

## How it works, end to end (the 13-step pipeline)

1. **Company research** — Firecrawl searches (and selectively scrapes) the company's site, press, filings, and bios; Claude synthesizes a structured company profile (business model, revenue drivers, cost structure, customers, channels, geography, competitors, suppliers, regulatory considerations, tech stack, value drivers) with a citation for every claim. Cached for 30 days (configurable) so re-running the same company doesn't re-spend Firecrawl credits.
2. **Dynamic expertise buckets** — Claude proposes 6–8 expertise areas tailored to *this* company's actual value drivers, not a generic fixed list.
3. **Candidate archetypes** — for each bucket, Claude names 2–3 specific job titles, each tagged with a *category* (`target_employee`, `competitor_employee`, `customer`, `channel_partner`, `supplier`, `industry_analyst`, `academic`, `consultant`, `trade_association`, `conference_speaker`, `product_reviewer` — see `backend/src/types.ts`). The prompt explicitly requires spreading archetypes across at least 5 of these categories per run, so the list reaches well beyond just the target's own former employees — toward the breadth of a professional expert network (GLG/AlphaSights-style), not just an alumni list.
4. **Real people search** — each archetype's *category* determines which sources and query templates run for it (see `backend/src/pipeline/categoryQueries.ts`):
   - **People Data Labs** — a licensed person-search API, queried by title + company. Only used for the four categories where "did this person ever work at a named company" is the right question (`target_employee`, `competitor_employee`, `customer`, `supplier`) — it has nothing to query against for an analyst, academic, or conference speaker, so it's skipped for those to avoid wasting API calls.
   - **Public web research (Firecrawl + Google Custom Search)** — Firecrawl search over press releases, executive bios, SEC filings, and conference speaker programs, plus Google CSE for `site:`-scoped queries (g2.com/capterra.com/trustradius.com for product reviewers, gartner.com/forrester.com/idc.com for industry analysts, `.edu` for academics, linkedin.com/in search-result *snippets* — never scraped page content — for everything else) when `GOOGLE_CSE_API_KEY`/`GOOGLE_CSE_CX` are set. A Claude pass extracts only explicitly-named individuals and their *stated* current/former company and title (it never guesses employment status — ambiguous cases are marked unknown, which matters for step 5).
   - **Grata** (optional, only if `GRATA_API_KEY` is set) — verified executive/board contact data for the target company itself, if the account's Grata plan includes the Data Warehouse module. Grata is also used earlier, in company research, to ground the competitor/similar-company list in structured data rather than LLM inference alone.
   - LinkedIn is never scraped. Proxycurl is not used (LinkedIn sued Proxycurl for this in January 2025; it shut down permanently in July 2025).
   - **Raylu** is a reserved-but-not-yet-wired source — see `backend/src/clients/raylu.ts` for why (their public docs don't expose a versioned API reference to build against yet).
5. **Compliance filter** — anyone currently employed by or on the board of the target company is hard-removed and never shown. Current employees of named competitors are flagged, not removed, for human compliance review.
6. **Scoring** — each surviving candidate gets a 0–100 score from relationship strength to the target, functional relevance/seniority, recency of the relevant tenure, and public thought-leadership signal.
7. **Question mapping** — each candidate is mapped to the diligence questions (user-supplied, or a standard 8-question commercial-DD framework if none given) they're best positioned to answer.
8. **Tiering** — Tier 1 (score ≥ 70), Tier 2 (45–69), Tier 3 (< 45).
9. **Bucket grouping** — the final list is organized by expertise bucket.
10. **Final table** — name, current/former company & title, relationship to target, bucket, tier, best-fit questions, reason for inclusion, source/LinkedIn citation, confidence score, compliance notes.
11. **Coverage score** — an overall 0–100 score plus bucket-by-bucket coverage, with concrete gaps flagged (e.g. "no sourcing expert identified") rather than force-filling a bucket with a weak candidate.
12. **Outside-the-box experts** — a fixed, always-runs supplementary sweep for consultants/trade-association execs/industry analysts, as a safety net in case a given run's archetype list under-covered one of those categories despite step 3's breadth requirement. Overlap with archetype-driven results is expected and deduplicated.
13. **Export** — the full result downloads as Excel (Candidates, Company Profile, Coverage, Run Info sheets).

## The moving parts

| Piece | What it is and where it lives |
|---|---|
| **Frontend** | The web page the team sees. Next.js + TypeScript. No paid API keys, no pipeline logic — just the form and results view. Deploy target: Vercel (free tier). |
| **Backend** | The always-on server that owns every paid API key and runs the pipeline. Express + TypeScript. Deploy target: Render (paid, ~$7/mo, no serverless duration cap). |
| **Code repo** | Source of truth for all code. GitHub. Render and Vercel auto-redeploy on push. |
| **Claude (Anthropic API)** | Research synthesis, bucket/archetype generation, candidate extraction, scoring, question mapping. Pay-per-use; cost is tracked exactly from real token usage. |
| **Firecrawl** | Company research and public-web candidate search. Pay-per-use; cost is estimated (exact per-call rate isn't in the response). |
| **People Data Labs** | Licensed structured person search. Billed per record returned; cost is estimated against a configurable per-record rate — check it against the firm's actual PDL plan. |
| **Google Custom Search** (optional) | Second web-search backend for `site:`-scoped queries (review sites, analyst sites, `.edu`, LinkedIn search-result snippets). Pay-per-use above a 100/day free tier; cost is estimated. No-op if `GOOGLE_CSE_API_KEY`/`GOOGLE_CSE_CX` are unset. |
| **Cache** | A SQLite file on the backend's disk, storing company-profile cache and run history. No separate database service. |

## Architecture at a glance

```
Browser (team)
   │
   ├──────────────► Vercel (Next.js frontend — thin UI, no keys)
   │
   └──────────────► Render (Express backend — always-on, owns all 3 API keys)
                         │        │         │
                         ▼        ▼         ▼
                    Firecrawl  Anthropic   People Data Labs
                    (research/  (reasoning/  (person search)
                     web search) scoring)
                         │
                         ▼
                    SQLite cache
                    (on Render's disk)
```

The browser calls the backend **directly**, not proxied through the frontend's server — this is why the backend has its own independent access-code check rather than relying solely on a frontend session cookie.

Code map (the files you'll touch most):

- `backend/src/main.ts` — backend entry point
- `backend/src/pipeline/runPipeline.ts` — the 13-step orchestrator
- `backend/src/pricing.ts` — the model list + live pricing (incl. the Sonnet 5 promo-rate cutover date)
- `backend/src/prompts/` — every system prompt (research synthesis, buckets/archetypes, web extraction, scoring, question mapping)
- `backend/src/clients/{anthropic,firecrawl,pdl}.ts` — the three external API wrappers
- `frontend/src/app/page.tsx` — frontend entry point
- `frontend/src/components/RunPanel.tsx` — the run + live-progress panel
- `frontend/src/components/ResultsPanel.tsx` — the results table + export

## The accounts this depends on

Five external accounts. All should be tethered to a shared Strattam email so access survives any one person leaving.

| Account | Role · what breaks without it |
|---|---|
| **GitHub** | Holds the code. |
| **Render** | Runs the backend and stores the SQLite cache. The one recurring bill (~$7/mo). |
| **Vercel** | Runs the frontend. Free. |
| **Anthropic** | Powers all the reasoning steps. If the key dies, the pipeline can't run at all. |
| **Firecrawl + People Data Labs** | Power company research and person search respectively. If either key dies, that half of candidate sourcing degrades (the other source still returns results — this is why two independent sources were built). |

## Models currently in use

| Model | When to use it | Price (per million tokens, in/out) |
|---|---|---|
| **Claude Haiku 4.5** | Cheap, fast workhorse — extraction and other high-volume steps. | $1.00 / $5.00 |
| **Claude Sonnet 5** | Balanced default. | $2.00 / $10.00 through Aug 31, 2026; $3.00 / $15.00 standard rate after. |
| **Claude Opus 5** | Sharpest, priciest — final scoring/synthesis on high-stakes runs. | $5.00 / $25.00 |

## What it costs

- **Fixed:** ~$7.25/month for Render. Vercel is free.
- **Variable:** Claude cost is reported exactly (from real token usage on every run). Firecrawl and People Data Labs costs are estimated per call/record — the constants live in the backend's `.env` (`FIRECRAWL_COST_PER_CALL_USD`, `PDL_COST_PER_RECORD_USD`) and should be checked against the firm's actual contracted rates, since neither provider returns the exact billed amount in its API response. People Data Labs in particular is typically sold as a subscription/credit-pack rather than pure pay-as-you-go, unlike Firecrawl — factor that into any budget conversation.

## Known limitations (v1)

- Company-profile caching is the only caching layer — candidates aren't cached across runs, since the set of archetypes/queries that produce them varies run to run.
- The `/cost/estimate` endpoint gives a rough range, not a precise pre-run count — unlike a fixed-row CSV scorer, this pipeline's cost depends on how much research and how many candidates a given company surfaces, which isn't known until the run happens.
- No per-user accounts or audit trail of who ran what — matches the "simple as the sibling tool" brief, but worth revisiting if usage grows or compliance wants a log of who pulled which candidates.
