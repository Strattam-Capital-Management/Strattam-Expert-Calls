// Archetype generation is combined with expertise-bucket generation in buckets.ts: one Claude
// call returns {buckets, archetypes} together, which reduces latency and cost versus a second
// round-trip. This file exists as the dedicated "archetypes" module the pipeline design calls
// for, and re-exports the archetype-related pieces so other modules can import from a module
// named for what it logically owns, without duplicating the LLM call.

export type { Archetype } from '../types';
export { generateBucketsAndArchetypes } from './buckets';
