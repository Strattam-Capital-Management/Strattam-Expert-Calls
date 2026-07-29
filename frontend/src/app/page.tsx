"use client";

import { useState } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import LoginGate from "@/components/LoginGate";
import CompanyStep from "@/components/CompanyStep";
import BriefStep from "@/components/BriefStep";
import ModelPicker from "@/components/ModelPicker";
import HowThisWorks from "@/components/HowThisWorks";
import RunPanel from "@/components/RunPanel";
import ResultsPanel from "@/components/ResultsPanel";
import type { CostSummary, DiligenceQuestion, RunResult } from "@/types";

function Wizard() {
  const { logout } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [companyHint, setCompanyHint] = useState("");
  const [thesis, setThesis] = useState("");
  const [questions, setQuestions] = useState<DiligenceQuestion[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [cost, setCost] = useState<CostSummary | undefined>(undefined);
  const [completedRunId, setCompletedRunId] = useState<string | null>(null);

  function handleCompleted(runResult: RunResult, runCost: CostSummary | undefined, runId: string) {
    setResult(runResult);
    setCost(runCost);
    setCompletedRunId(runId);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Expert Interview Candidate Sourcing
          </h1>
          <p className="text-sm text-slate-500">Strattam Capital internal tool</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="text-sm text-slate-400 underline hover:text-slate-600"
        >
          Sign out
        </button>
      </header>

      <div className="space-y-6">
        <CompanyStep
          companyName={companyName}
          onCompanyNameChange={setCompanyName}
          companyHint={companyHint}
          onCompanyHintChange={setCompanyHint}
        />
        <BriefStep
          thesis={thesis}
          onThesisChange={setThesis}
          questions={questions}
          onQuestionsChange={setQuestions}
        />
        <ModelPicker selectedModel={model} onSelectModel={setModel} />
        <HowThisWorks />
        <RunPanel
          companyName={companyName}
          companyHint={companyHint}
          thesis={thesis}
          questions={questions}
          model={model}
          onCompleted={handleCompleted}
        />
        {result && completedRunId && (
          <ResultsPanel result={result} cost={cost} runId={completedRunId} />
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <LoginGate>
        <Wizard />
      </LoginGate>
    </AuthProvider>
  );
}
