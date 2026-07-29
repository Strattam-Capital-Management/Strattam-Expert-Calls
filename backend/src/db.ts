import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG } from './config';

const dir = path.dirname(CONFIG.dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(CONFIG.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  company_hint TEXT,
  thesis TEXT,
  diligence_questions_json TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  error TEXT,
  result_json TEXT,
  cost_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS company_cache (
  cache_key TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
`);

export interface RunRow {
  id: string;
  company_name: string;
  company_hint: string | null;
  thesis: string | null;
  diligence_questions_json: string | null;
  model: string;
  status: 'running' | 'completed' | 'error';
  stage: string;
  error: string | null;
  result_json: string | null;
  cost_json: string | null;
  started_at: string;
  finished_at: string | null;
}

export function createRun(row: {
  id: string;
  companyName: string;
  companyHint?: string;
  thesis?: string;
  diligenceQuestionsJson?: string;
  model: string;
}): void {
  db.prepare(
    `INSERT INTO runs (id, company_name, company_hint, thesis, diligence_questions_json, model, status, stage, started_at)
     VALUES (@id, @companyName, @companyHint, @thesis, @diligenceQuestionsJson, @model, 'running', 'queued', @startedAt)`
  ).run({
    id: row.id,
    companyName: row.companyName,
    companyHint: row.companyHint ?? null,
    thesis: row.thesis ?? null,
    diligenceQuestionsJson: row.diligenceQuestionsJson ?? null,
    model: row.model,
    startedAt: new Date().toISOString(),
  });
}

export function updateRunStage(id: string, stage: string): void {
  db.prepare(`UPDATE runs SET stage = ? WHERE id = ?`).run(stage, id);
}

export function completeRun(id: string, resultJson: string, costJson: string): void {
  db.prepare(
    `UPDATE runs SET status = 'completed', stage = 'done', result_json = ?, cost_json = ?, finished_at = ? WHERE id = ?`
  ).run(resultJson, costJson, new Date().toISOString(), id);
}

export function failRun(id: string, error: string, costJson?: string): void {
  db.prepare(
    `UPDATE runs SET status = 'error', stage = 'error', error = ?, cost_json = COALESCE(?, cost_json), finished_at = ? WHERE id = ?`
  ).run(error, costJson ?? null, new Date().toISOString(), id);
}

export function getRun(id: string): RunRow | undefined {
  return db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
}

export function getCacheStats(): { cachedCompanies: number; totalRuns: number } {
  const cachedCompanies = (db.prepare(`SELECT COUNT(*) as c FROM company_cache`).get() as any).c;
  const totalRuns = (db.prepare(`SELECT COUNT(*) as c FROM runs`).get() as any).c;
  return { cachedCompanies, totalRuns };
}

export function getCachedProfile(cacheKey: string, ttlDays: number): any | null {
  const row = db.prepare(`SELECT * FROM company_cache WHERE cache_key = ?`).get(cacheKey) as
    | { cache_key: string; profile_json: string; fetched_at: string }
    | undefined;
  if (!row) return null;
  const fetchedAt = new Date(row.fetched_at).getTime();
  const ageMs = Date.now() - fetchedAt;
  if (ageMs > ttlDays * 24 * 60 * 60 * 1000) return null;
  try {
    return JSON.parse(row.profile_json);
  } catch {
    return null;
  }
}

export function setCachedProfile(cacheKey: string, profile: unknown): void {
  db.prepare(
    `INSERT INTO company_cache (cache_key, profile_json, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET profile_json = excluded.profile_json, fetched_at = excluded.fetched_at`
  ).run(cacheKey, JSON.stringify(profile), new Date().toISOString());
}
