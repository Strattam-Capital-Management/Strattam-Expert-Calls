"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import type { DiligenceQuestion } from "@/types";

interface BriefStepProps {
  thesis: string;
  onThesisChange: (value: string) => void;
  questions: DiligenceQuestion[];
  onQuestionsChange: (questions: DiligenceQuestion[]) => void;
}

let questionCounter = 0;
function nextId(): string {
  questionCounter += 1;
  return `custom-${Date.now()}-${questionCounter}`;
}

export default function BriefStep({
  thesis,
  onThesisChange,
  questions,
  onQuestionsChange,
}: BriefStepProps) {
  const { code } = useAuth();
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newQuestion, setNewQuestion] = useState("");
  const [hasLoadedDefaults, setHasLoadedDefaults] = useState(false);

  useEffect(() => {
    if (!code || hasLoadedDefaults) return;
    let cancelled = false;
    setIsLoadingDefaults(true);
    api
      .getDefaultQuestions(code)
      .then((res) => {
        if (!cancelled) onQuestionsChange(res.questions);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load default questions.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingDefaults(false);
          setHasLoadedDefaults(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, hasLoadedDefaults]);

  function updateQuestionText(id: string, text: string) {
    onQuestionsChange(questions.map((q) => (q.id === id ? { ...q, text } : q)));
  }

  function removeQuestion(id: string) {
    onQuestionsChange(questions.filter((q) => q.id !== id));
  }

  function addQuestion() {
    if (!newQuestion.trim()) return;
    onQuestionsChange([...questions, { id: nextId(), text: newQuestion.trim(), topics: [] }]);
    setNewQuestion("");
  }

  function clearAll() {
    onQuestionsChange([]);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">
        2. Investment thesis &amp; diligence questions
      </h2>
      <p className="mt-1 text-sm text-slate-500">Both are optional but help focus the search.</p>

      <label className="mt-4 block text-sm font-medium text-slate-700">
        Investment thesis (optional)
      </label>
      <textarea
        value={thesis}
        onChange={(e) => onThesisChange(e.target.value)}
        rows={3}
        placeholder="What's the thesis on this company? Any specific angles the interviews should probe?"
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />

      <div className="mt-5 flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700">Diligence questions</label>
        {questions.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-slate-400 underline hover:text-slate-600"
          >
            clear all
          </button>
        )}
      </div>

      {isLoadingDefaults && (
        <p className="mt-2 text-sm text-slate-500">Loading default questions...</p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {!isLoadingDefaults && questions.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">
          No questions yet — add your own below, or reload the page to pull the default list.
        </p>
      )}

      <ul className="mt-2 space-y-2">
        {questions.map((q) => (
          <li key={q.id} className="flex items-start gap-2">
            <input
              type="text"
              value={q.text}
              onChange={(e) => updateQuestionText(q.id, e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
            <button
              type="button"
              onClick={() => removeQuestion(q.id)}
              className="rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-500 hover:bg-slate-50"
              aria-label="Remove question"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addQuestion();
            }
          }}
          placeholder="Add a diligence question"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
        <button
          type="button"
          onClick={addQuestion}
          disabled={!newQuestion.trim()}
          className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  );
}
