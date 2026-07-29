import * as crypto from 'crypto';
import { pdlPersonSearch, PdlPerson } from '../clients/pdl';
import { firecrawlSearch } from '../clients/firecrawl';
import { GrataExecutiveContact } from '../clients/grata';
import { callClaude, extractJson } from '../clients/anthropic';
import { WEB_CANDIDATE_EXTRACTION_SYSTEM_PROMPT } from '../prompts/webExtraction';
import { createLimiter } from '../util/limit';
import { CONFIG } from '../config';
import type { Archetype, Bucket, CandidateDraft, CompanyProfile, RelationshipToTarget } from '../types';
import type { CostTracker } from '../costTracker';

// NOTE ON LINKEDIN / PROXYCURL: this module deliberately does NOT scrape LinkedIn directly,
// and does NOT implement Proxycurl as a real data source. LinkedIn sued Proxycurl in January
// 2025 for exactly this kind of scraping, and Proxycurl shut down permanently in July 2025.
// A documented "why we don't do this" placeholder lives at
// src/pipeline/legacy/proxycurl.DO_NOT_USE.ts.txt (non-executable, not imported anywhere).
// Real people-search here comes from two independent, licensed/legitimate sources instead:
// People Data Labs (structured, licensed aggregator) and Firecrawl web search + Claude
// extraction of explicitly-named individuals from public press/bios/filings.

function norm(s?: string): string {
  return (s ?? '').trim().toLowerCase();
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Builds a PDL Elasticsearch DSL query for "title roughly matches AND worked at one of these
 * companies (ever, per the experience.* array)". Deliberately avoids the two constructs that
 * 400-error on PDL despite being valid vanilla Elasticsearch: `nested` clauses and
 * `minimum_should_match`. The company OR-group is its own inner bool with only `should`
 * clauses and no must/filter, which requires at least one match by default - no
 * minimum_should_match needed. Dotted subfield paths (experience.title.name,
 * experience.company.name) are queried directly rather than the bare `experience` field.
 */
function buildPdlQuery(titleText: string, companies: string[]): unknown {
  return {
    bool: {
      must: [
        { match: { 'experience.title.name': titleText } },
        {
          bool: {
            should: companies.map((c) => ({ match: { 'experience.company.name': c } })),
          },
        },
      ],
    },
  };
}

function stripFormerPrefix(title: string): string {
  return title.replace(/^former\s+/i, '').trim();
}

interface RelationshipClassification {
  relationshipToTarget: RelationshipToTarget;
  currentCompany?: string;
  currentTitle?: string;
  formerCompany?: string;
  formerTitle?: string;
  tenureNote?: string;
}

function classifyFromPdlPerson(
  person: PdlPerson,
  companyName: string,
  competitors: string[],
  suppliers: string[],
  customers: string[]
): RelationshipClassification {
  const targetNorm = norm(companyName);
  const competitorNorms = new Set(competitors.map(norm));
  const supplierNorms = new Set(suppliers.map(norm));
  const customerNorms = new Set(customers.map(norm));

  const currentCompany = person.job_company_name;
  const currentTitle = person.job_title;
  const currentCompanyNorm = norm(currentCompany);
  const experience = person.experience ?? [];

  const findPastMatch = (norms: Set<string>) =>
    experience.find((e) => {
      const cNorm = norm(e.company?.name);
      if (!cNorm || !norms.has(cNorm)) return false;
      // Treat as "past" if it has an end_date, or simply isn't the person's current company.
      return Boolean(e.end_date) || cNorm !== currentCompanyNorm;
    });

  const tenureNoteFor = (e: NonNullable<PdlPerson['experience']>[number], company: string): string => {
    const start = e.start_date ?? '';
    const end = e.end_date ?? 'present';
    return `${e.title?.name ?? 'Role'} at ${company}${start ? `, ${start} - ${end}` : ''}`;
  };

  // 1. Former employee of the target - highest-value relationship.
  const targetMatch = experience.find((e) => norm(e.company?.name) === targetNorm);
  if (targetMatch && !(currentCompanyNorm === targetNorm)) {
    return {
      relationshipToTarget: 'former_employee',
      currentCompany,
      currentTitle,
      formerCompany: companyName,
      formerTitle: targetMatch.title?.name ?? currentTitle,
      tenureNote: tenureNoteFor(targetMatch, companyName),
    };
  }

  // 2. Current employee of the target - the compliance filter hard-removes these downstream
  //    by comparing currentCompany directly, but we still classify honestly here.
  if (currentCompanyNorm === targetNorm) {
    return { relationshipToTarget: 'other', currentCompany, currentTitle };
  }

  // 3. Current employee of a named competitor.
  if (currentCompanyNorm && competitorNorms.has(currentCompanyNorm)) {
    return { relationshipToTarget: 'current_competitor_employee', currentCompany, currentTitle };
  }

  // 4. Former employee of a named competitor.
  const competitorMatch = findPastMatch(competitorNorms);
  if (competitorMatch) {
    return {
      relationshipToTarget: 'former_competitor_employee',
      currentCompany,
      currentTitle,
      formerCompany: competitorMatch.company?.name,
      formerTitle: competitorMatch.title?.name,
      tenureNote: tenureNoteFor(competitorMatch, competitorMatch.company?.name ?? ''),
    };
  }

  // 5. Supplier relationship - contract enum only has "former_supplier" (no "current"), so any
  //    supplier match is reported as former_supplier regardless of current/past.
  const supplierMatch =
    experience.find((e) => supplierNorms.has(norm(e.company?.name))) ??
    (currentCompanyNorm && supplierNorms.has(currentCompanyNorm) ? experience[0] : undefined);
  if (currentCompanyNorm && supplierNorms.has(currentCompanyNorm)) {
    return {
      relationshipToTarget: 'former_supplier',
      currentCompany,
      currentTitle,
      formerCompany: currentCompany,
      formerTitle: currentTitle,
      tenureNote: 'Currently at a named supplier - verify current vs. former relationship before outreach.',
    };
  }
  if (supplierMatch) {
    return {
      relationshipToTarget: 'former_supplier',
      currentCompany,
      currentTitle,
      formerCompany: supplierMatch.company?.name,
      formerTitle: supplierMatch.title?.name,
      tenureNote: tenureNoteFor(supplierMatch, supplierMatch.company?.name ?? ''),
    };
  }

  // 6. Customer relationship.
  if (currentCompanyNorm && customerNorms.has(currentCompanyNorm)) {
    return { relationshipToTarget: 'current_customer', currentCompany, currentTitle };
  }
  const customerMatch = findPastMatch(customerNorms);
  if (customerMatch) {
    return {
      relationshipToTarget: 'former_customer',
      currentCompany,
      currentTitle,
      formerCompany: customerMatch.company?.name,
      formerTitle: customerMatch.title?.name,
      tenureNote: tenureNoteFor(customerMatch, customerMatch.company?.name ?? ''),
    };
  }

  return { relationshipToTarget: 'other', currentCompany, currentTitle };
}

async function searchPdlForArchetype(
  archetype: Archetype,
  companyName: string,
  profile: CompanyProfile,
  costTracker: CostTracker
): Promise<CandidateDraft[]> {
  const titleText = stripFormerPrefix(archetype.title);
  const companies = [companyName, ...profile.competitors, ...profile.suppliers, ...profile.customers].filter(
    Boolean
  );
  const query = buildPdlQuery(titleText, companies);

  const resp = await pdlPersonSearch(query, 20, costTracker);
  if (!resp.success) return [];

  return resp.data
    .filter((p) => p.full_name)
    .map((p) => {
      const classification = classifyFromPdlPerson(
        p,
        companyName,
        profile.competitors,
        profile.suppliers,
        profile.customers
      );
      const draft: CandidateDraft = {
        id: newId(),
        name: p.full_name as string,
        currentCompany: classification.currentCompany,
        currentTitle: classification.currentTitle,
        formerCompany: classification.formerCompany,
        formerTitle: classification.formerTitle,
        relevantRole: archetype.title,
        relationshipToTarget: classification.relationshipToTarget,
        expertiseBucketId: archetype.bucketId,
        tenureNote: classification.tenureNote,
        linkedinUrl: typeof p.linkedin_url === 'string' ? p.linkedin_url : undefined,
        biographySource: 'People Data Labs structured person search',
        outsideTheBox: false,
      };
      return draft;
    });
}

async function searchWebForArchetype(
  archetype: Archetype,
  bucket: Bucket | undefined,
  companyName: string,
  companyHint: string | undefined,
  profile: CompanyProfile,
  model: string,
  costTracker: CostTracker
): Promise<CandidateDraft[]> {
  const hintSuffix = companyHint ? ` (${companyHint})` : '';
  const query = `"${archetype.title}" ${companyName}${hintSuffix} named executive OR press release OR conference bio`;

  const searchResult = await firecrawlSearch({ query, limit: 10, costTracker });
  if (!searchResult.success || searchResult.results.length === 0) return [];

  const snippetText = searchResult.results
    .map((r) => `URL: ${r.url}\nTITLE: ${r.title ?? ''}\nSNIPPET: ${r.description ?? ''}`)
    .join('\n\n---\n\n')
    .slice(0, 20_000);

  const userMessage = `Target company: ${companyName}${hintSuffix}
Archetype being sourced: "${archetype.title}" (${archetype.whyValuable})
Expertise bucket: ${bucket?.name ?? archetype.bucketId}

Web search snippets:

${snippetText}

Extract any explicitly-named individuals matching this archetype per the rules in your system
prompt. Return JSON only.`;

  const result = await callClaude({
    model,
    system: WEB_CANDIDATE_EXTRACTION_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 2500,
    stepName: `web-extraction-${archetype.bucketId}`,
    costTracker,
  });

  const parsed = extractJson(result.text);
  const people: any[] = parsed.people ?? [];

  const competitorNorms = new Set(profile.competitors.map(norm));
  const supplierNorms = new Set(profile.suppliers.map(norm));
  const customerNorms = new Set(profile.customers.map(norm));
  const targetNorm = norm(companyName);

  const drafts: CandidateDraft[] = [];

  for (const person of people) {
    if (!person.name || !person.company || !person.title) continue;
    const companyNorm = norm(person.company);
    const status: 'current' | 'former' | 'unknown' = person.employmentStatus ?? 'unknown';

    // Compliance safety: if this person's company is the TARGET and we cannot confirm
    // (from the source text) whether they're current or former, we cannot safely include
    // them - a current employee/board member of the target must never appear in output, and
    // we refuse to guess. Skip rather than risk a compliance miss.
    if (companyNorm === targetNorm && status === 'unknown') {
      console.warn(
        `[peopleSearch] dropping "${person.name}" - ambiguous current/former status at target company, cannot safely include`
      );
      continue;
    }

    let relationshipToTarget: RelationshipToTarget = 'other';
    let currentCompany: string | undefined;
    let currentTitle: string | undefined;
    let formerCompany: string | undefined;
    let formerTitle: string | undefined;
    let complianceNotes: string | undefined;

    if (companyNorm === targetNorm) {
      // status === 'former' at this point (unknown+target already skipped above).
      relationshipToTarget = 'former_employee';
      formerCompany = person.company;
      formerTitle = person.title;
    } else if (competitorNorms.has(companyNorm)) {
      if (status === 'current') {
        relationshipToTarget = 'current_competitor_employee';
        currentCompany = person.company;
        currentTitle = person.title;
      } else if (status === 'former') {
        relationshipToTarget = 'former_competitor_employee';
        formerCompany = person.company;
        formerTitle = person.title;
      } else {
        relationshipToTarget = 'other';
        currentCompany = person.company;
        currentTitle = person.title;
        complianceNotes = 'Employment status (current vs. former) at a named competitor could not be confirmed from source text - verify before outreach.';
      }
    } else if (supplierNorms.has(companyNorm)) {
      relationshipToTarget = 'former_supplier';
      if (status === 'current') {
        currentCompany = person.company;
        currentTitle = person.title;
      } else {
        formerCompany = person.company;
        formerTitle = person.title;
      }
    } else if (customerNorms.has(companyNorm)) {
      relationshipToTarget = status === 'current' ? 'current_customer' : 'former_customer';
      if (status === 'current') {
        currentCompany = person.company;
        currentTitle = person.title;
      } else {
        formerCompany = person.company;
        formerTitle = person.title;
      }
    } else {
      if (status === 'current') {
        currentCompany = person.company;
        currentTitle = person.title;
      } else {
        formerCompany = person.company;
        formerTitle = person.title;
      }
    }

    drafts.push({
      id: newId(),
      name: person.name,
      currentCompany,
      currentTitle,
      formerCompany,
      formerTitle,
      relevantRole: person.role || archetype.title,
      relationshipToTarget,
      expertiseBucketId: archetype.bucketId,
      tenureNote: status === 'unknown' ? 'Current vs. former employment status unconfirmed from source text.' : undefined,
      linkedinUrl: undefined,
      biographySource: `${person.sourceLabel ?? 'Public web source'} (${person.sourceUrl ?? 'no URL captured'})`,
      outsideTheBox: false,
      complianceNotes,
    });
  }

  return drafts;
}

/**
 * Turns Grata's executive/board-contact data for the TARGET company (see research.ts, which
 * enriches only the target itself, not every competitor/supplier/customer - doing that too
 * would multiply Grata API calls across every named company and wasn't in scope for this pass)
 * into candidate drafts. These are naturally the highest-value category when present - former
 * employees of the target - so they're assigned to whichever bucket's name best keyword-matches
 * their title (a cheap heuristic, not a scored LLM judgment, since Grata returns a flat
 * leadership list rather than per-archetype results the way PDL/web search do).
 *
 * Employment-status honesty mirrors the web-extraction path: if Grata doesn't clearly mark a
 * contact as current vs. former (`is_current` present and boolean), we refuse to guess - and
 * because these are executives of the TARGET company specifically, an unconfirmed status here
 * is exactly the ambiguous-current-employee case the compliance filter exists to catch, so we
 * drop rather than risk a compliance miss (same policy as searchWebForArchetype).
 */
function draftsFromGrataExecutives(
  executives: GrataExecutiveContact[],
  companyName: string,
  buckets: Bucket[]
): CandidateDraft[] {
  if (executives.length === 0 || buckets.length === 0) return [];

  const bucketWords = buckets.map((b) => ({
    bucket: b,
    words: new Set(norm(b.name).split(/\s+/).filter(Boolean)),
  }));

  const pickBucketId = (title: string): string => {
    const titleWords = norm(title).split(/\s+/).filter(Boolean);
    let best = bucketWords[0];
    let bestScore = -1;
    for (const bw of bucketWords) {
      const score = titleWords.filter((w) => bw.words.has(w)).length;
      if (score > bestScore) {
        bestScore = score;
        best = bw;
      }
    }
    return best.bucket.id;
  };

  const drafts: CandidateDraft[] = [];
  for (const exec of executives) {
    const name = exec.full_name ?? exec.name;
    const title = exec.title ?? exec.job_title;
    if (!name || !title) continue;

    if (typeof exec.is_current !== 'boolean') {
      console.warn(
        `[peopleSearch] dropping "${name}" from Grata executive contacts - current/former status at target company not confirmed`
      );
      continue;
    }

    const draft: CandidateDraft = {
      id: newId(),
      name,
      relevantRole: title,
      relationshipToTarget: exec.is_current ? 'other' : 'former_employee',
      expertiseBucketId: pickBucketId(title),
      linkedinUrl: exec.linkedin_url,
      biographySource: 'Grata verified executive/board contact data',
      outsideTheBox: false,
    };
    if (exec.is_current) {
      draft.currentCompany = companyName;
      draft.currentTitle = title;
    } else {
      draft.formerCompany = companyName;
      draft.formerTitle = title;
      draft.tenureNote = `${title} at ${companyName} (former, per Grata)`;
    }
    drafts.push(draft);
  }
  return drafts;
}

function dedupeCandidates(candidates: CandidateDraft[]): CandidateDraft[] {
  const seen = new Set<string>();
  const out: CandidateDraft[] = [];
  for (const c of candidates) {
    const key = `${norm(c.name)}::${norm(c.currentCompany ?? c.formerCompany)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Stage 4 of the pipeline. Runs real people-search sources independently across all archetypes
 * (so any one source failing doesn't blank the run): People Data Labs (throttled to
 * PDL_CONCURRENCY, e.g. 3 at a time), Firecrawl search + Claude extraction of explicitly-named
 * individuals from public press/bios/filings, and - if GRATA_API_KEY is configured and
 * `grataExecutives` is non-empty - Grata's verified executive/board contact data for the target
 * company itself (see research.ts and draftsFromGrataExecutives above).
 */
export async function sourceCandidates(
  archetypes: Archetype[],
  buckets: Bucket[],
  companyName: string,
  companyHint: string | undefined,
  profile: CompanyProfile,
  model: string,
  costTracker: CostTracker,
  grataExecutives: GrataExecutiveContact[] = []
): Promise<CandidateDraft[]> {
  const bucketById = new Map(buckets.map((b) => [b.id, b]));
  const limit = createLimiter(CONFIG.pdlConcurrency);

  const pdlResults = await Promise.all(
    archetypes.map((archetype) =>
      limit(() => searchPdlForArchetype(archetype, companyName, profile, costTracker))
    )
  );

  const webResults = await Promise.all(
    archetypes.map((archetype) =>
      limit(() =>
        searchWebForArchetype(
          archetype,
          bucketById.get(archetype.bucketId),
          companyName,
          companyHint,
          profile,
          model,
          costTracker
        )
      )
    )
  );

  const grataDrafts = draftsFromGrataExecutives(grataExecutives, companyName, buckets);

  const all = [...pdlResults.flat(), ...webResults.flat(), ...grataDrafts];
  return dedupeCandidates(all);
}
