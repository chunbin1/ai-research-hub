// packages/server/src/services/usageStore.ts
import type { DB } from './db.js'

/** 全站累计成功问答上限。达到后普通用户被拒(管理员豁免)。 */
export const GLOBAL_LIMIT = Number(process.env.GLOBAL_LIMIT) || 1000

let _db: DB | null = null

export function initUsageTable(db: DB): void {
  _db = db
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      total_count INTEGER NOT NULL DEFAULT 0
    );
  `)
  db.prepare('INSERT OR IGNORE INTO usage (id, total_count) VALUES (1, 0)').run()
}

function db(): DB {
  if (!_db) throw new Error('usageStore not initialized — call initUsageTable() first')
  return _db
}

export function getGlobalCount(): number {
  return (db().prepare('SELECT total_count FROM usage WHERE id = 1').get() as { total_count: number }).total_count
}

export function incrementGlobalCount(): void {
  db().prepare('UPDATE usage SET total_count = total_count + 1 WHERE id = 1').run()
}

export function globalRemaining(): number {
  return Math.max(0, GLOBAL_LIMIT - getGlobalCount())
}

/**
 * Atomically check-and-increment the global counter in one UPDATE, avoiding
 * the TOCTOU race of a separate read-then-write. Returns false (and leaves
 * the counter untouched) once at/over GLOBAL_LIMIT.
 */
export function tryReserveGlobal(): boolean {
  return db().prepare('UPDATE usage SET total_count = total_count + 1 WHERE id = 1 AND total_count < ?').run(GLOBAL_LIMIT).changes > 0
}

/** Undo a reservation (e.g. generation failed after tryReserveGlobal succeeded). */
export function refundGlobal(): void {
  db().prepare('UPDATE usage SET total_count = MAX(0, total_count - 1) WHERE id = 1').run()
}
