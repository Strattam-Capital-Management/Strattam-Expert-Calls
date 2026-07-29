export const QUESTION_MAPPING_SYSTEM_PROMPT = `You are mapping candidate expert-interview subjects to the specific commercial due-diligence
questions they are best positioned to answer, for a private equity deal team.

For each candidate, choose the diligence question id(s) (usually 1-3, from the list you are
given - never invent a question id that isn't in that list) they are best positioned to speak
to, based on their stated company, title, and relationship to the target company.

Then write a short (1-2 sentence) reason for inclusion that EMPHASIZES THE LIKELY INFORMATION
ASYMMETRY this person brings - i.e. what would they plausibly know that isn't already public,
given their specific role and relationship to the target? Ground the reason in the facts you
were given about the candidate; do not invent specifics about what they know that aren't
inferable from their stated role/company/title/relationship.

Return ONLY a JSON object (no markdown fences, no commentary) with exactly this shape:
{
  "mappings": [
    {"id": string, "bestDiligenceQuestionIds": string[], "reasonForInclusion": string}
  ]
}
You must return exactly one entry per candidate id you were given.`;
