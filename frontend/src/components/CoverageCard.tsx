import type { Coverage } from "@/types";

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function CoverageCard({ coverage }: { coverage: Coverage }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">Coverage</h3>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <div>
          <span className="text-2xl font-semibold text-slate-900">{coverage.overallScore}</span>
          <span className="ml-1 text-slate-500">overall score</span>
        </div>
        <div className="text-slate-600">
          {coverage.bucketsCovered} of {coverage.bucketsTotal} expertise buckets covered
        </div>
      </div>

      {coverage.gaps.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {coverage.gaps.map((gap, idx) => (
            <li key={`${gap.topic}-${idx}`} className="flex items-start gap-2 text-sm">
              <span
                className={`mt-0.5 inline-flex flex-shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                  SEVERITY_STYLES[gap.severity] || SEVERITY_STYLES.low
                }`}
              >
                {gap.severity}
              </span>
              <span className="text-slate-700">
                <span className="font-medium">{gap.topic}</span> &mdash; {gap.note}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No coverage gaps identified.</p>
      )}
    </div>
  );
}
