"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import type { CostSummary, DiligenceQuestion, RunResult } from "@/types";

// Maps the raw pipeline stage strings the backend reports to a friendly,
// plain-English label. Unknown stage strings fall back to a humanized
// version of the raw string so the UI never shows a blank or a raw
// snake_case token.
const STAGE_LABELS: Record<string, string> = {
  queued: "Queued...",
  // Exact stage strings emitted by backend src/pipeline/runPipeline.ts
  researching_company: "Researching the company...",
  generating_expertise_buckets_and_archetypes: "Identifying expertise areas & candidate archetypes...",
  sourcing_candidates: "Searching for real people (licensed data + web research)...",
  searching_outside_the_box_experts: "Looking for outside-the-box experts...",
  running_compliance_filter: "Filtering for compliance...",
  scoring_candidates: "Scoring candidates...",
  mapping_diligence_questions: "Mapping candidates to your questions...",
  tiering_and_grouping_candidates: "Assigning tiers & grouping by bucket...",
  computing_coverage: "Checking coverage gaps...",
  // Aliases kept as a safety net in case the backend's stage naming ever drifts
  company_research: "Researching the company...",
  building_expertise_buckets: "Identifying expertise areas...",
  expertise_buckets: "Identifying expertise areas...",
  generating_archetypes: "Drafting candidate archetypes...",
  candidate_archetypes: "Drafting candidate archetypes...",
  searching_people: "Searching for real people...",
  searching_candidates: "Searching for real people...",
  people_search: "Searching for real people...",
  compliance_filter: "Filtering for compliance...",
  scoring: "Scoring candidates...",
  question_mapping: "Mapping candidates to your questions...",
  tiering_candidates: "Assigning tiers...",
  tiering: "Assigning tiers...",
  analyzing_coverage: "Checking coverage gaps...",
  coverage_analysis: "Checking coverage gaps...",
  coverage_gap_analysis: "Checking coverage gaps...",
  searching_outside_the_box: "Looking for outside-the-box experts...",
  outside_the_box_search: "Looking for outside-the-box experts...",
  finalizing: "Finalizing results...",
};

function humanizeStage(stage: string): string {
  if (!stage) return "Working...";
  if (STAGE_LABELS[stage]) return STAGE_LABELS[stage];
  const words = stage.replace(/[_-]+/g, " ").trim();
  if (!words) return "Working...";
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
  return `${capitalized}...`;
}

const POLL_INTERVAL_MS = 3000;

interface RunPanelProps {
  companyName: string;
  companyHint: string;
  thesis: string;
  questions: DiligenceQuestion[];
  model: string | null;
  onCompleted: (result: RunResult, cost: CostSummary | undefined, runId: string) => void;
}

type RunState = "idle" | "starting" | "running" | "completed" | "error";

export default function RunPanel({
  companyName,
  companyHint,
  thesis,
  questions,
  model,
  onCompleted,
}: RunPanelProps) {
  const { code } = useAuth();
  const [state, setState] = useState<RunState>("idle");
  const [stage, setStage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  async function poll(id: string, accessCode: string) {
    try {
      const res = await api.getRun(id, accessCode);
      if (res.status === "running") {
        setStage(res.stage);
        pollTimer.current = setTimeout(() => poll(id, accessCode), POLL_INTERVAL_MS);
      } else if (res.status === "completed") {
        setState("completed");
        setStage(res.stage);
        if (res.result) {
          onCompleted(res.result, res.cost, id);
        }
      } else {
        setState("error");
        setError(res.error || "The run failed.");
      }
    } catch {
      // Transient network hiccup: keep polling rather than giving up, since
      // this is a long-running backend job and a single failed poll doesn't
      // mean the run itself failed.
      pollTimer.current = setTimeout(() => poll(id, accessCode), POLL_INTERVAL_MS);
    }
  }

  async function handleRun() {
    if (!code || !model || !companyName.trim()) return;
    setState("starting");
    setError(null);
    try {
      const res = await api.startRun(
        {
          companyName: companyName.trim(),
          companyHint: companyHint || undefined,
          thesis: thesis || undefined,
          diligenceQuestions: questions.length > 0 ? questions : undefined,
          model,
        },
        code
      );
      setRunId(res.runId);
      setState("running");
      setStage("queued");
      poll(res.runId, code);
    } catch (err) {
      setState("error");
      setError(err instanceof ApiError ? err.message : "Could not start the run.");
    }
  }

  const canRun =
    Boolean(companyName.trim() && model && code) && state !== "starting" && state !== "running";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">4. Run</h2>
      <p className="mt-1 text-sm text-slate-500">
        This can take anywhere from 20 seconds to several minutes. You can leave this page open —
        it will keep checking on progress automatically.
      </p>

      <button
        type="button"
        onClick={handleRun}
        disabled={!canRun}
        className="mt-4 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "running" || state === "starting" ? "Running..." : "Run sourcing"}
      </button>

      {(state === "starting" || state === "running") && (
        <div className="mt-4 flex items-center gap-3">
          <span className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
          <span className="text-sm text-slate-700">{humanizeStage(stage || "starting")}</span>
        </div>
      )}

      {state === "error" && error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {state === "completed" && (
        <p className="mt-4 text-sm text-emerald-700">Done — see results below.</p>
      )}

      {runId && <p className="mt-2 text-xs text-slate-400">Run ID: {runId}</p>}
    </section>
  );
}
