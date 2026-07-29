"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import type { CostEstimate, ModelInfo } from "@/types";

interface ModelPickerProps {
  selectedModel: string | null;
  onSelectModel: (modelId: string) => void;
}

export default function ModelPicker({ selectedModel, onSelectModel }: ModelPickerProps) {
  const { code } = useAuth();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [isLoadingEstimate, setIsLoadingEstimate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setIsLoadingModels(true);
    api
      .getModels(code)
      .then((res) => {
        if (cancelled) return;
        setModels(res.models);
        if (!selectedModel && res.models.length > 0) {
          onSelectModel(res.models[0].id);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load models.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    if (!code || !selectedModel) return;
    let cancelled = false;
    setIsLoadingEstimate(true);
    setEstimate(null);
    api
      .estimateCost(selectedModel, code)
      .then((res) => {
        if (!cancelled) setEstimate(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not estimate cost.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingEstimate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, selectedModel]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">3. Model</h2>
      <p className="mt-1 text-sm text-slate-500">Pick which Claude model does the reasoning.</p>

      {isLoadingModels && <p className="mt-3 text-sm text-slate-500">Loading models...</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {models.map((m) => (
          <label
            key={m.id}
            className={`cursor-pointer rounded-lg border p-3 text-sm transition ${
              selectedModel === m.id
                ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                : "border-slate-200 hover:border-slate-400"
            }`}
          >
            <div className="flex items-start gap-2">
              <input
                type="radio"
                name="model"
                checked={selectedModel === m.id}
                onChange={() => onSelectModel(m.id)}
                className="mt-1"
              />
              <div>
                <div className="font-medium text-slate-900">{m.label}</div>
                <div className="mt-0.5 text-xs text-slate-600">{m.blurb}</div>
                <div className="mt-1 text-xs text-slate-400">
                  ${m.inputPerM.toFixed(2)}/M in &middot; ${m.outputPerM.toFixed(2)}/M out
                </div>
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
        {isLoadingEstimate && <span className="text-slate-500">Estimating cost...</span>}
        {!isLoadingEstimate && estimate && (
          <>
            <span className="font-medium text-slate-900">
              Estimated cost: ${estimate.estimatedLowUsd.toFixed(2)}&ndash;$
              {estimate.estimatedHighUsd.toFixed(2)}
            </span>
            <span className="ml-1 text-xs text-slate-500">(approximate &mdash; {estimate.note})</span>
          </>
        )}
        {!isLoadingEstimate && !estimate && (
          <span className="text-slate-400">Select a model to see an approximate cost range.</span>
        )}
      </div>
    </section>
  );
}
