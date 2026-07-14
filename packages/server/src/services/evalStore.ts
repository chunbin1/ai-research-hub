// packages/server/src/services/evalStore.ts
import type { DB } from './db.js'

export type EvalStatus = 'running' | 'done' | 'failed'

export interface EvalRunRow {
  id: string
  doc_id: string
  status: EvalStatus
  question_count: number
  avg_recall: number | null
  avg_precision: number | null
  avg_faithfulness: number | null
  avg_relevancy: number | null
  started_at: string
  finished_at: string | null
}

export interface EvalResultRow {
  id: string
  run_id: string
  question: string
  expected: string
  retrieved_sections: string
  answer: string
  recall: number
  precision: number
  faithfulness: number
  relevancy: number
  reasoning: string
  created_at: string
}

let _db: DB | null = null

export function initEvalTables(db: DB): void {
  _db = db
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_runs (
      id               TEXT PRIMARY KEY,
      doc_id           TEXT NOT NULL,
      status           TEXT NOT NULL,
      question_count   INTEGER NOT NULL DEFAULT 0,
      avg_recall       REAL,
      avg_precision    REAL,
      avg_faithfulness REAL,
      avg_relevancy    REAL,
      started_at       TEXT NOT NULL,
      finished_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_eval_runs_doc ON eval_runs(doc_id, started_at);
    CREATE TABLE IF NOT EXISTS eval_results (
      id                 TEXT PRIMARY KEY,
      run_id             TEXT NOT NULL,
      question           TEXT NOT NULL,
      expected           TEXT NOT NULL,
      retrieved_sections TEXT NOT NULL,
      answer             TEXT NOT NULL,
      recall             REAL NOT NULL,
      precision          REAL NOT NULL,
      faithfulness       REAL NOT NULL,
      relevancy          REAL NOT NULL,
      reasoning          TEXT NOT NULL,
      created_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results(run_id);
  `)
}

function db(): DB {
  if (!_db) throw new Error('evalStore not initialized — call initEvalTables() first')
  return _db
}
const now = () => new Date().toISOString()
const rid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

export function createRun(docId: string): string {
  const id = rid('run')
  db().prepare(
    `INSERT INTO eval_runs (id, doc_id, status, question_count, started_at) VALUES (?, ?, 'running', 0, ?)`,
  ).run(id, docId, now())
  return id
}

export function setQuestionCount(runId: string, n: number): void {
  db().prepare('UPDATE eval_runs SET question_count = ? WHERE id = ?').run(n, runId)
}

export function insertResult(runId: string, r: {
  question: string; expected: string; retrieved_sections: string; answer: string;
  recall: number; precision: number; faithfulness: number; relevancy: number; reasoning: string
}): void {
  db().prepare(
    `INSERT INTO eval_results
     (id, run_id, question, expected, retrieved_sections, answer, recall, precision, faithfulness, relevancy, reasoning, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(rid('res'), runId, r.question, r.expected, r.retrieved_sections, r.answer,
    r.recall, r.precision, r.faithfulness, r.relevancy, r.reasoning, now())
}

export function finishRun(runId: string, a: { recall: number; precision: number; faithfulness: number; relevancy: number }): void {
  db().prepare(
    `UPDATE eval_runs SET status='done', avg_recall=?, avg_precision=?, avg_faithfulness=?, avg_relevancy=?, finished_at=? WHERE id=?`,
  ).run(a.recall, a.precision, a.faithfulness, a.relevancy, now(), runId)
}

export function failRun(runId: string): void {
  db().prepare(`UPDATE eval_runs SET status='failed', finished_at=? WHERE id=?`).run(now(), runId)
}

export function hasRunningRun(docId: string): boolean {
  const r = db().prepare(`SELECT 1 FROM eval_runs WHERE doc_id=? AND status='running' LIMIT 1`).get(docId)
  return !!r
}

export function getLatestRunByDoc(docId: string): EvalRunRow | null {
  return (db().prepare(
    'SELECT * FROM eval_runs WHERE doc_id=? ORDER BY started_at DESC LIMIT 1',
  ).get(docId) as EvalRunRow) ?? null
}

export function getResults(runId: string): EvalResultRow[] {
  return db().prepare('SELECT * FROM eval_results WHERE run_id=? ORDER BY created_at ASC').all(runId) as EvalResultRow[]
}

/** 每个 doc 的最新 run 里,取 status='done' 的,算全站平均。 */
export function aggregateStats(): { docsEvaluated: number; avgRecall: number; avgPrecision: number; avgFaithfulness: number; avgRelevancy: number } {
  const rows = db().prepare(`
    SELECT r.* FROM eval_runs r
    JOIN (SELECT doc_id, MAX(started_at) AS mx FROM eval_runs GROUP BY doc_id) latest
      ON r.doc_id = latest.doc_id AND r.started_at = latest.mx
    WHERE r.status='done'
  `).all() as EvalRunRow[]
  const n = rows.length
  if (n === 0) return { docsEvaluated: 0, avgRecall: 0, avgPrecision: 0, avgFaithfulness: 0, avgRelevancy: 0 }
  const s = rows.reduce((a, r) => ({
    cr: a.cr + (r.avg_recall ?? 0), cp: a.cp + (r.avg_precision ?? 0),
    f: a.f + (r.avg_faithfulness ?? 0), ar: a.ar + (r.avg_relevancy ?? 0),
  }), { cr: 0, cp: 0, f: 0, ar: 0 })
  return { docsEvaluated: n, avgRecall: s.cr / n, avgPrecision: s.cp / n, avgFaithfulness: s.f / n, avgRelevancy: s.ar / n }
}

export function markStaleRunsFailed(): void {
  db().prepare(`UPDATE eval_runs SET status='failed', finished_at=? WHERE status='running'`).run(now())
}
