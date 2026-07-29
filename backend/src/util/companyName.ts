/**
 * Robust company-name comparison. This exists because the compliance filter and the
 * current/former classification logic both need to answer "is this person's employer the
 * SAME company as the target?" - and comparing raw strings with a plain trim+lowercase (which
 * is what this codebase used everywhere before this file existed) is too brittle for real
 * companies. A press release might say "Floor & Decor Holdings, Inc." while the user typed
 * "Floor & Decor" - those don't match on a plain string comparison, which means a current CEO
 * of the target company can silently slip past the hard-remove check in compliance.ts simply
 * because of a legal-suffix or punctuation difference, not because anything else went wrong.
 * That is a real safety bug, not a cosmetic one, so this normalizer is deliberately more
 * aggressive than the simple `norm()` helpers still used elsewhere in this codebase for
 * unrelated things (like deduplicating candidates by person name).
 */

const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'llc', 'lc', 'ltd', 'limited', 'holdings', 'holding', 'group',
  'plc', 'lp', 'llp', 'gmbh', 'ag', 'sa', 'nv', 'pty', 'srl',
]);

export function normalizeCompanyName(raw?: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase();
  s = s.replace(/&/g, ' and ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return '';

  let words = s.split(' ').filter(Boolean);
  // Strip trailing legal-suffix words (there can be more than one, e.g. "holdings inc").
  // Always keep at least one word so a company literally named e.g. "Group" isn't reduced to "".
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) {
    words = words.slice(0, -1);
  }
  return words.join(' ');
}

/** True if two company name strings plausibly refer to the same company, after stripping
 * legal suffixes and punctuation differences. */
export function isSameCompany(a?: string, b?: string): boolean {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return false;
  return na === nb;
}

/** Builds the set of normalized name variants that all refer to the target company - the
 * literal name the user typed, whatever companyHint they confirmed at disambiguation, and
 * whatever canonical name Claude's research step settled on (which may differ from what the
 * user typed, e.g. if research found the full legal/SEC name). Any of these matching a
 * candidate's employer is treated as "this is the target company." */
export function buildTargetAliasSet(companyName: string, researchedCompanyName?: string, companyHint?: string): Set<string> {
  const set = new Set<string>();
  for (const v of [companyName, researchedCompanyName, companyHint]) {
    const n = normalizeCompanyName(v);
    if (n) set.add(n);
  }
  return set;
}

/** Builds a normalized alias set from a list of company names (e.g. profile.competitors),
 * for the same "does this candidate's employer match ANY of these" comparisons. */
export function buildAliasSet(names: string[]): Set<string> {
  const set = new Set<string>();
  for (const n of names) {
    const norm = normalizeCompanyName(n);
    if (norm) set.add(norm);
  }
  return set;
}

export function matchesAlias(name: string | undefined, aliases: Set<string>): boolean {
  const n = normalizeCompanyName(name);
  if (!n) return false;
  return aliases.has(n);
}
