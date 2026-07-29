# Expert Interview Candidate Sourcing Tool — Frontend

Internal Strattam Capital tool. Next.js (App Router) + TypeScript + Tailwind CSS,
built as a single-page wizard: log in -> pick company -> add thesis/questions ->
pick model -> run -> view ranked/tiered candidates.

## Local development

```bash
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_API_BASE to your backend URL
npm run dev
```

Then open http://localhost:3000.

## Environment variables

- `NEXT_PUBLIC_API_BASE` — base URL of the Express/Node backend (e.g.
  `http://localhost:4000`). The browser calls this backend directly; the
  Next.js server itself does not proxy or store any API calls.
- `ACCESS_CODE_SESSION_SECRET` — optional, only relevant if you later add a
  server-side cookie to gate which pages render before the client-side auth
  check runs. Not used by v1: the shared access code lives only in React
  state for the lifetime of the tab and is never written to
  localStorage/sessionStorage/cookies. It is resent explicitly as the
  `X-Access-Code` header on every backend call (and as a `?code=` query
  param on the one plain `<a>` link — the Excel export — that can't set
  custom headers).

## How it works (for reviewers)

1. `LoginGate` posts the code to `/auth/check` and holds it in
   `AuthContext` (memory only) once accepted.
2. `CompanyStep` calls `/company/disambiguate` and lets the analyst confirm
   which real company they mean; skipping confirmation is allowed and just
   means no `companyHint` is sent.
3. `BriefStep` prefills diligence questions from `/questions/default`,
   editable/removable, plus an optional thesis textarea.
4. `ModelPicker` loads `/cost/models` and fetches a `/cost/estimate` for the
   selected model.
5. `HowThisWorks` is a collapsible explainer of the 6 conceptual phases of
   the pipeline, for non-technical reviewers.
6. `RunPanel` calls `/run/start`, then polls `/run/:id` every ~3s, mapping
   the raw `stage` string to a plain-English label via a lookup table (with
   a generic humanizer fallback for any stage string not in the table).
   Polling continues indefinitely while `status === "running"` — there is no
   client-side timeout, matching the always-on backend.
7. `ResultsPanel` renders the coverage summary, a candidate table grouped by
   expertise bucket (sortable by confidence/tier/name, default confidence
   desc), the compliance summary line, an itemized cost breakdown, and an
   Excel export link built from `exportUrl()` (`?code=` query param, not a
   header, since it's a plain anchor tag).

## Notes / things to double check against the live backend

- Stage-label mapping in `src/components/RunPanel.tsx` is a best guess at
  the backend's stage string names; update `STAGE_LABELS` once the backend
  agent confirms the exact strings it emits (unknown strings still degrade
  gracefully to a humanized label instead of breaking).
- `ResultsPanel` falls back to grouping by raw `expertiseBucketId` if a
  candidate references a bucket id not present in `result.buckets`, so no
  candidate is silently dropped if the two arrays are ever inconsistent.
- No live backend was available while building this; verification was
  `npm install`, `npx tsc --noEmit`, and `npm run build` only.
