"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import type { DisambiguationCandidate } from "@/types";

interface CompanyStepProps {
  companyName: string;
  onCompanyNameChange: (value: string) => void;
  companyHint: string;
  onCompanyHintChange: (value: string) => void;
}

export default function CompanyStep({
  companyName,
  onCompanyNameChange,
  companyHint,
  onCompanyHintChange,
}: CompanyStepProps) {
  const { code } = useAuth();
  const [candidates, setCandidates] = useState<DisambiguationCandidate[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  async function handleDisambiguate() {
    if (!companyName.trim() || !code) return;
    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const res = await api.disambiguateCompany(companyName.trim(), code);
      setCandidates(res.candidates.slice(0, 5));
      setSelectedDomain(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not look up that company.");
      setCandidates([]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSelect(candidate: DisambiguationCandidate) {
    setSelectedDomain(candidate.domain);
    onCompanyHintChange(`${candidate.name} (${candidate.domain})`);
  }

  function handleClearSelection() {
    setSelectedDomain(null);
    onCompanyHintChange("");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">1. Target company</h2>
      <p className="mt-1 text-sm text-slate-500">
        Enter the company name. We&apos;ll try to confirm which company you mean, since many
        company names are ambiguous.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={companyName}
          onChange={(e) => {
            onCompanyNameChange(e.target.value);
            if (selectedDomain) handleClearSelection();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleDisambiguate();
            }
          }}
          placeholder="e.g. Acme Robotics"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
        <button
          type="button"
          onClick={handleDisambiguate}
          disabled={isLoading || !companyName.trim()}
          className="whitespace-nowrap rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Searching..." : "Confirm company"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {hasSearched && !isLoading && candidates.length === 0 && !error && (
        <p className="mt-3 text-sm text-slate-500">
          No matches found. That&apos;s fine — you can still proceed with the name as typed.
        </p>
      )}

      {candidates.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {candidates.map((c) => (
            <div
              key={c.domain}
              role="button"
              tabIndex={0}
              onClick={() => handleSelect(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelect(c);
                }
              }}
              className={`cursor-pointer rounded-lg border p-3 text-left text-sm transition ${
                selectedDomain === c.domain
                  ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                  : "border-slate-200 hover:border-slate-400"
              }`}
            >
              <div className="font-medium text-slate-900">{c.name}</div>
              {/* Clickable link to the actual site, so you can eyeball it and confirm this is
                  really the company you mean before running the full pipeline against it.
                  stopPropagation keeps the click from also selecting the card - opening the
                  site and selecting the candidate are two separate actions. */}
              <a
                href={c.domain.startsWith("http") ? c.domain : `https://${c.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-block text-xs text-blue-600 underline hover:text-blue-800"
              >
                {c.domain} ↗
              </a>
              <div className="mt-1 text-xs text-slate-600">{c.oneLiner}</div>
            </div>
          ))}
        </div>
      )}

      {companyHint && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <span>Confirmed: {companyHint}</span>
          <button
            type="button"
            onClick={handleClearSelection}
            className="text-xs text-slate-400 underline hover:text-slate-600"
          >
            clear
          </button>
        </div>
      )}
    </section>
  );
}
