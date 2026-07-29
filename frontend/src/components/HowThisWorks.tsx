"use client";

import { useState } from "react";

const PHASES = [
  {
    title: "1. Research the company",
    body: "We pull together a profile of the target: what it sells, how it makes money, who its customers and competitors are, and where it operates.",
  },
  {
    title: "2. Build expertise buckets & archetypes",
    body: 'Based on that profile, we identify the specific areas of expertise that would be most useful (e.g. "former enterprise sales leader" or "regional competitor operator") rather than searching generically.',
  },
  {
    title: "3. Search for real people",
    body: "We search a licensed professional data API plus public web sources to find named individuals who actually match those archetypes.",
  },
  {
    title: "4. Compliance filter",
    body: "Anyone who is a current employee or board member of the target company is removed automatically. Employees of close competitors are flagged for extra review rather than removed outright.",
  },
  {
    title: "5. Score & tier",
    body: "Remaining candidates are scored on relevance and confidence, then grouped into Tier 1/2/3 so you can prioritize outreach.",
  },
  {
    title: "6. Map to your questions & check coverage",
    body: "Each candidate is matched to the diligence questions they're best positioned to answer, and we flag any topic areas that still lack strong candidate coverage.",
  },
];

export default function HowThisWorks() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
        aria-expanded={isOpen}
      >
        <span className="text-sm font-medium text-slate-900">How this works</span>
        <span className="text-slate-400">{isOpen ? "−" : "+"}</span>
      </button>
      {isOpen && (
        <div className="space-y-3 border-t border-slate-100 px-6 py-4">
          {PHASES.map((phase) => (
            <div key={phase.title}>
              <div className="text-sm font-medium text-slate-800">{phase.title}</div>
              <div className="text-sm text-slate-600">{phase.body}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
