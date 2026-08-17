import * as crypto from 'crypto';
import { pdlPersonSearch, PdlPerson } from '../clients/pdl';
import { firecrawlSearch } from '../clients/firecrawl';
import { googleCseSearch } from '../clients/googleCse';
import { GrataExecutiveContact } from '../clients/grata';
import { callClaude, extractJson } from '../clients/anthropic';
import { WEB_CANDIDATE_EXTRACTION_SYSTEM_PROMPT } from '../prompts/webExtraction';
import { createLimiter } from '../util/limit';
import { buildAliasSet, buildTargetAliasSet, matchesAlias, isSameCompany } from '../util/companyName';
import { buildWebQueries, isPdlEligible, relationshipForUnaffiliatedCategory } from './categoryQueries';
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
  companyHint: string | undefined,
  researchedCompanyName: string | undefined,
  competitors: string[],
  suppliers: string[],
  customers: string[]
): RelationshipClassification {
  // Fuzzy matching (see util/companyName.ts) - PDL job_company_name / experience.company.name
  // strings often carry legal suffixes ("Floor & Decor Holdings, Inc.") that a plain string
  // comparison against whatever the user typed ("Floor & Decor") would miss entirely.
  const targetAliases = buildTargetAliasSet(companyName, researchedCompanyName, companyHint);
  const competitorAliases = buildAliasSet(competitors);
  const supplierAliases = buildAliasSet(suppliers);
  const customerAliases = buildAliasSet(customers);

  const currentCompany = person.job_company_name;
  const currentTitle = person.job_title;
  const isCurrentTarget = matchesAlias(currentCompany, targetAliases);
  const experience = person.experience ?? [];

  const findPastMatch = (aliases: Set<string>) =>
    experience.find((e) => {
      if (!matchesAlias(e.company?.name, aliases)) return false;
      // Treat as "past" if it has an end_date, or simply isn't the person's current company.
      return Boolean(e.end_date) || !isSameCompany(e.company?.name, currentCompany);
    });

  const tenureNoteFor = (e: NonNullable<PdlPerson['experience']>[number], company: string): string => {
    const start = e.start_date ?? '';
    const end = e.end_date ?? 'present';
    return `${e.title?.name ?? 'Role'} at ${company}${start ? `, ${start} - ${end}` : ''}`;
  };

  // 1. Former employee of the target - highest-value relationship.
  const targetMatch = experience.find((e) => matchesAlias(e.company?.name, targetAliases));
  if (targetMatch && !isCurrentTarget) {
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
  //    by comparing currentCompany directly (same fuzzy match), but we still classify honestly
  //    here too, and critically still populate currentCompany so that hard-remove can happen.
  if (isCurrentTarget) {
    return { relationshipToTarget: 'other', currentCompany, currentTitle };
  }

  // 3. Current employee of a named competitor.
  if (matchesAlias(currentCompany, competitorAliases)) {
    return { relationshipToTarget: 'current_competitor_employee', currentCompany, currentTitle };
  }

  // 4. Former employee of a named competitor.
  const competitorMatch = findPastMatch(competitorAliases);
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
  if (matchesAlias(currentCompany, supplierAliases)) {
    return {
      relationshipToTarget: 'former_supplier',
      currentCompany,
      currentTitle,
      formerCompany: currentCompany,
      formerTitle: currentTitle,
      tenureNote: 'Currently at a named supplier - verify current vs. former relationship before outreach.',
    };
  }
  const supplierMatch = findPastMatch(supplierAliases);
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
  if (matchesAlias(currentCompany, customerAliases)) {
    return { relationshipToTarget: 'current_customer', currentCompany, currentTitle };
  }
  const customerMatch = findPastMatch(customerAliases);
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
  companyHint: string | undefined,
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
        companyHint,
        profile.companyName,
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
  const industry = profile.industry || `${companyName}'s industry`;
  const categoryQueries = buildWebQueries(archetype.category, archetype.title, companyName, hintSuffix, industry);

  // Each category's query plan (see categoryQueries.ts) says which queries are Firecrawl's
  // general web search vs. Google CSE's site:-scoped search (analysts on gartner.com,
  // reviewers on g2.com/capterra.com, academics on .edu, etc). Running both backends across all
  // of an archetype's queries and merging into one snippet corpus is what actually delivers the
  // "beyond just former employees" breadth - a single generic query per archetype couldn't
  // reach these categories at all.
  //
  // Firecrawl calls request full-page markdown for the top hits (scrapeTopHits), not just the
  // bare search-result snippet - a named individual is very often mentioned in an article's
  // body, not in its one-line meta-description, so extraction working from snippets alone was
  // missing real people even when Firecrawl found exactly the right page. Cost trade-off: a
  // scrape-included search costs more per call than a bare search, so `limit` drops from 10 to
  // 5 to keep total cost from growing 2x - 5 real pages of content beats 10 thin snippets for
  // this specific job. Google CSE has no scraping equivalent (by design - see clients/
  // googleCse.ts's note on why it only ever reads Google's own snippet), so those queries are
  // unaffected.
  const searchCalls = categoryQueries.map((cq) =>
    cq.useCse
      ? googleCseSearch(cq.query, { limit: 10, costTracker })
      : firecrawlSearch({ query: cq.query, limit: 5, scrapeTopHits: true, costTracker })
  );
  const searchResponses = await Promise.all(searchCalls);

  const combinedResults = searchResponses.flatMap((r) => (r.success ? r.results : []));
  if (combinedResults.length === 0) return [];

  const snippetText = combinedResults
    .map((r) => {
      // Prefer real page content (markdown) when Firecrawl scraped it; fall back to the bare
      // snippet for Google CSE results, which never include page content by design. Each
      // result's content is capped so one long page can't crowd out every other result before
      // the overall 20k-char budget kicks in below.
      const body = r.markdown ? r.markdown.slice(0, 4000) : r.description ?? '';
      return `URL: ${r.url}\nTITLE: ${r.title ?? ''}\nCONTENT: ${body}`;
    })
    .join('\n\n---\n\n')
    .slice(0, 24_000);

  const userMessage = `Target company: ${companyName}${hintSuffix}
Archetype being sourced: "${archetype.title}" (${archetype.whyValuable})
Archetype category: ${archetype.category}
Expertise bucket: ${bucket?.name ?? archetype.bucketId}

Web search snippets:

${snippetText}

Extract any explicitly-named individuals matching this archetype per the rules in your system
prompt. Return JSON only.`;

  const result = await callClaude({
    model,
    system: WEB_CANDIDATE_EXTRACTION_SYSTEM_PROMPT,
    userMessage,
    // Was 2500 - bumped alongside the real-page-content change above, since feeding Claude
    // actual article bodies instead of one-line snippets means it can legitimately find (and
    // needs to write out) more people per call than before.
    maxTokens: 4000,
    stepName: `web-extraction-${archetype.bucketId}`,
    costTracker,
  });

  const parsed = extractJson(result.text);
  const people: any[] = parsed.people ?? [];

  // Fuzzy matching (see util/companyName.ts) - a plain string comparison here previously let a
  // current employee of the target slip through as an unrelated "other" candidate whenever the
  // source text used a different legal form of the company's name than what the user typed
  // (e.g. "Floor & Decor" vs. "Floor & Decor Holdings, Inc."). The target alias set also
  // includes the company name Claude's research step settled on, since that may be the fuller/
  // legal name even when the user typed a shorter colloquial one.
  const competitorAliases = buildAliasSet(profile.competitors);
  const supplierAliases = buildAliasSet(profile.suppliers);
  const customerAliases = buildAliasSet(profile.customers);
  const targetAliases = buildTargetAliasSet(companyName, profile.companyName, companyHint);

  const drafts: CandidateDraft[] = [];

  for (const person of people) {
    if (!person.name || !person.company || !person.title) continue;
    const isTarget = matchesAlias(person.company, targetAliases);
    const status: 'current' | 'former' | 'unknown' = person.employmentStatus ?? 'unknown';

    // Compliance safety: if this person's company is the TARGET and we cannot confirm
    // (from the source text) whether they're current or former, we cannot safely include
    // them - a current employee/board member of the target must never appear in output, and
    // we refuse to guess. Skip rather than risk a compliance miss.
    if (isTarget && status === 'unknown') {
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

    if (isTarget) {
      if (status === 'current') {
        // Deliberately relationshipToTarget: 'other', NOT 'former_employee' - and critically,
        // currentCompany (not formerCompany) must be set here, since that's the field
        // compliance.ts checks to hard-remove sitting employees/board members of the target.
        // Getting this backwards was the bug that let current executives of the target through
        // as if they were unrelated "other" candidates.
        relationshipToTarget = 'other';
        currentCompany = person.company;
        currentTitle = person.title;
      } else {
        // status === 'former' (unknown+target already skipped above).
        relationshipToTarget = 'former_employee';
        formerCompany = person.company;
        formerTitle = person.title;
      }
    } else if (matchesAlias(person.company, competitorAliases)) {
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
    } else if (matchesAlias(person.company, supplierAliases)) {
      relationshipToTarget = 'former_supplier';
      if (status === 'current') {
        currentCompany = person.company;
        currentTitle = person.title;
      } else {
        formerCompany = person.company;
        formerTitle = person.title;
      }
    } else if (matchesAlias(person.company, customerAliases)) {
      relationshipToTarget = status === 'current' ? 'current_customer' : 'former_customer';
      if (status === 'current') {
        currentCompany = person.company;
        currentTitle = person.title;
      } else {
        formerCompany = person.company;
        formerTitle = person.title;
      }
    } else {
      // Didn't match any named company from the CompanyProfile - for the newer, unaffiliated-
      // expert archetype categories (industry_analyst/academic/consultant/trade_association/
      // conference_speaker/product_reviewer/channel_partner), that's actually the EXPECTED case
      // (a Gartner analyst or a professor was never going to show up in profile.competitors),
      // so tag them with what they actually are per the archetype category being searched,
      // rather than collapsing them into the generic 'other' relationship that made this exact
      // category of candidate hard to distinguish from noise downstream.
      relationshipToTarget = relationshipForUnaffiliatedCategory(archetype.category);
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
 * PDL_CONCURRENCY, e.g. 3 at a time - only for archetype categories where "did this person ever
 * work at a specific named company" is even the right question, see isPdlEligible in
 * categoryQueries.ts), Firecrawl + Google CSE search with category-tailored queries and Claude
 * extraction of explicitly-named individuals, and - if GRATA_API_KEY is configured and
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
      isPdlEligible(archetype.category)
        ? limit(() => searchPdlForArchetype(archetype, companyName, companyHint, profile, costTracker))
        : Promise.resolve([])
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
