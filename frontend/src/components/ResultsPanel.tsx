"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { exportUrl } from "@/lib/api";
import type { Candidate, CostSummary, RunResult } from "@/types";
import CoverageCard from "./CoverageCard";
import TierBadge from "./TierBadge";

interface ResultsPanelProps {
  result: RunResult;
  cost?: CostSummary;
  runId: string;
}

type SortKey = "confidence" | "tier" | "name";

const TIER_ORDER: Record<string, number> = { "Tier 1": 0, "Tier 2": 1, "Tier 3": 2 };

function sortCandidates(candidates: Candidate[], key: SortKey): Candidate[] {
  const copy = [...candidates];
  copy.sort((a, b) => {
    if (key === "confidence") return b.confidenceScore - a.confidenceScore;
    if (key === "name") return a.name.localeCompare(b.name);
    return (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9);
  });
  return copy;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export default function ResultsPanel({ result, cost, runId }: ResultsPanelProps) {
  const { code } = useAuth();
  const [sortKey, setSortKey] = useState<SortKey>("confidence");

  const bucketGroups = useMemo(() => {
    const map = new Map<string, { name: string; candidates: Candidate[] }>();
    for (const bucket of result.buckets) {
      map.set(bucket.id, { name: bucket.name, candidates: [] });
    }
    for (const candidate of result.candidates) {
      const bucket = map.get(candidate.expertiseBucketId);
      if (bucket) {
        bucket.candidates.push(candidate);
      } else {
        // Fallback in case a candidate references a bucket id we don't
        // otherwise know about — still show them rather than drop them.
        map.set(candidate.expertiseBucketId, {
          name: candidate.expertiseBucketId,
          candidates: [candidate],
        });
      }
    }
    return Array.from(map.entries()).filter(([, bucket]) => bucket.candidates.length > 0);
  }, [result.buckets, result.candidates]);

  const questionsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of result.diligenceQuestions) map.set(q.id, q.text);
    return map;
  }, [result.diligenceQuestions]);

  const compliance = result.complianceSummary;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CoverageCard coverage={result.coverage} />

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">Cost</h3>
          {cost && cost.breakdown.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {cost.breakdown.map((item, idx) => (
                <li key={`${item.label}-${idx}`} className="flex items-center justify-between">
                  <span className="text-slate-700">
                    {item.label}{" "}
                    <span className="text-xs text-slate-400">
                      ({item.basis === "exact" ? "exact" : "estimated"})
                    </span>
                  </span>
                  <span className="font-medium text-slate-900">${item.usd.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Cost details are not available for this run.</p>
          )}
          {cost && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-slate-900">
              <span>Total</span>
              <span>${cost.totalUsd.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-700">
          <span className="font-medium">{compliance.hardRemovedCount}</span> candidates removed as
          current employees/board members of the target;{" "}
          <span className="font-medium">{compliance.flaggedCompetitorCount}</span> competitor
          employees flagged for review.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">Candidates</h3>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="sort-key" className="text-slate-500">
              Sort by
            </label>
            <select
              id="sort-key"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="confidence">Confidence</option>
              <option value="tier">Tier</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        <div className="mt-4 space-y-8">
          {bucketGroups.map(([bucketId, bucket]) => {
            const sorted = sortCandidates(bucket.candidates, sortKey);
            return (
              <div key={bucketId}>
                <h4 className="text-sm font-semibold text-slate-800">{bucket.name}</h4>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3">Name</th>
                        <th className="py-2 pr-3">Company / Title</th>
                        <th className="py-2 pr-3">Relationship</th>
                        <th className="py-2 pr-3">Tier</th>
                        <th className="py-2 pr-3">Best questions</th>
                        <th className="py-2 pr-3">Reason</th>
                        <th className="py-2 pr-3">Confidence</th>
                        <th className="py-2 pr-3">Compliance</th>
                        <th className="py-2 pr-3">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sorted.map((c) => (
                        <tr key={c.id} className="align-top">
                          <td className="py-2 pr-3 font-medium text-slate-900">
                            {c.name}
                            {c.outsideTheBox && (
                              <span className="ml-2 inline-flex items-center rounded-full border border-purple-200 bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-800">
                                outside the box
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-slate-700">
                            {c.currentCompany && (
                              <div>
                                <span className="text-xs text-slate-400">Current: </span>
                                {c.currentTitle ? `${c.currentTitle}, ` : ""}
                                {c.currentCompany}
                              </div>
                            )}
                            {c.formerCompany && (
                              <div>
                                <span className="text-xs text-slate-400">Former: </span>
                                {c.formerTitle ? `${c.formerTitle}, ` : ""}
                                {c.formerCompany}
                              </div>
                            )}
                            {c.tenureNote && <div className="text-xs text-slate-400">{c.tenureNote}</div>}
                          </td>
                          <td className="py-2 pr-3 text-slate-700">
                            {c.relationshipToTarget.replace(/_/g, " ")}
                          </td>
                          <td className="py-2 pr-3">
                            <TierBadge tier={c.tier} />
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex max-w-xs flex-wrap gap-1">
                              {c.bestDiligenceQuestionIds.map((qid) => (
                                <span
                                  key={qid}
                                  title={questionsById.get(qid) || qid}
                                  className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                                >
                                  {questionsById.get(qid) ? truncate(questionsById.get(qid) as string, 28) : qid}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="max-w-xs py-2 pr-3 text-slate-700">{c.reasonForInclusion}</td>
                          <td className="py-2 pr-3 text-slate-700">{c.confidenceScore}</td>
                          <td className="py-2 pr-3 text-slate-700">
                            {c.complianceNotes ? (
                              <span className="text-amber-700">{c.complianceNotes}</span>
                            ) : (
                              <span className="text-slate-300">&mdash;</span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <a
                              href={c.linkedinUrl || c.biographySource}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-600 underline hover:text-slate-900"
                            >
                              {c.linkedinUrl ? "LinkedIn" : "Source"}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end">
        <a
          href={code ? exportUrl(runId, code) : "#"}
          download
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Export to Excel
        </a>
      </div>
    </div>
  );
}
