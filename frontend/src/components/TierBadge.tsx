import type { Tier } from "@/types";

const TIER_STYLES: Record<Tier, string> = {
  "Tier 1": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Tier 2": "bg-amber-100 text-amber-800 border-amber-200",
  "Tier 3": "bg-slate-100 text-slate-700 border-slate-200",
};

export default function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TIER_STYLES[tier]}`}
    >
      {tier}
    </span>
  );
}
