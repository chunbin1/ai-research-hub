// packages/server/src/services/indexState.ts
//
// 每篇文档的索引代次状态。它是两路索引的**唯一真相**:查询按 active_gen 过滤
// 向量,重建按它判断该跳过还是该干活。
//
// 三个代次分开记,因为它们会在重建过程中短暂地不一致:
//
//   vec_gen     已经写完**并且验证过**的那批向量的代次
//   fts_gen     FTS 表里那批行的代次
//   active_gen  查询实际使用的代次 —— 只有两路都就位才翻到新代
//
// 翻转 active_gen 是单条 UPDATE,和 FTS 的重建放在同一个事务里。所以任何时刻
// 从外面看过去,一篇文档要么整个是旧代、要么整个是新代,没有中间态。

import type { DB } from './db.js'

export interface IndexState {
  doc_id: string
  active_gen: string
  vec_gen: string
  fts_gen: string
  embed_model: string
  updated_at: string
}

export function initIndexStateTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_index_state (
      doc_id      TEXT PRIMARY KEY,
      active_gen  TEXT NOT NULL,
      vec_gen     TEXT NOT NULL,
      fts_gen     TEXT NOT NULL,
      embed_model TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `)
}

/**
 * 没有行 = 这篇还没被代次化(本次改动之前建的索引)。
 *
 * 调用方必须把 null 当作「legacy 模式:查询不加代次过滤」,而不是当作错误 ——
 * 部署完到第一次重建之间,全库都是这个状态,站点必须照常工作。
 */
export function getIndexState(db: DB, docId: string): IndexState | null {
  return (db.prepare('SELECT * FROM doc_index_state WHERE doc_id = ?').get(docId) as IndexState) ?? null
}

export function listIndexState(db: DB): IndexState[] {
  return db.prepare('SELECT * FROM doc_index_state ORDER BY doc_id').all() as IndexState[]
}

/** 整行写入 —— 重建成功翻转时用,三个代次一起落地。 */
export function putIndexState(
  db: DB,
  s: Omit<IndexState, 'updated_at'> & { updated_at?: string },
): void {
  db.prepare(`
    INSERT INTO doc_index_state (doc_id, active_gen, vec_gen, fts_gen, embed_model, updated_at)
    VALUES (@doc_id, @active_gen, @vec_gen, @fts_gen, @embed_model, @updated_at)
    ON CONFLICT(doc_id) DO UPDATE SET
      active_gen  = excluded.active_gen,
      vec_gen     = excluded.vec_gen,
      fts_gen     = excluded.fts_gen,
      embed_model = excluded.embed_model,
      updated_at  = excluded.updated_at
  `).run({ ...s, updated_at: s.updated_at ?? new Date().toISOString() })
}

/**
 * 只更新 FTS 代次 —— `pnpm reindex` 用。
 *
 * 它**故意不碰 active_gen**:单独重建 FTS 就是会让两路错位,这里如实记下来,
 * 让检索侧查得出 fts_gen ≠ active_gen 并降级。把它悄悄改成一致才是危险的。
 *
 * 没有状态行时什么也不做 —— 那是 legacy 模式,本来就没有代次可言。
 */
export function setFtsGen(db: DB, docId: string, gen: string): void {
  db.prepare('UPDATE doc_index_state SET fts_gen = ?, updated_at = ? WHERE doc_id = ?')
    .run(gen, new Date().toISOString(), docId)
}

export function deleteIndexState(db: DB, docId: string): void {
  db.prepare('DELETE FROM doc_index_state WHERE doc_id = ?').run(docId)
}

/**
 * 两路对得上吗?对不上就不能按 chunk_index 融合。
 *
 * null(legacy)算一致 —— 那时候两路都是同一版切块建的,只是没有标记。
 */
export function isConsistent(s: IndexState | null): boolean {
  return s === null || (s.fts_gen === s.active_gen && s.vec_gen === s.active_gen)
}

export interface RetrievalPlan {
  /** 向量查询按它过滤;null = legacy,不过滤。 */
  gen: string | null
  /** 只走这一路;null = 两路融合。 */
  restrict: 'vector' | 'bm25' | null
}

/**
 * 决定这篇该怎么查。
 *
 * 两路代次不一致时**绝不融合** —— 融合按 chunk_index 对齐,而错位的两代里同一个
 * 编号指的是不同的文字,融出来的结果比任何一路单独都差,而且是静默的。这时退成
 * 「跟得上 active_gen 的那一路单独跑」:内容也许旧,但自洽、完整,而且降级会被
 * 记进 trace,看得见。
 */
export function planRetrieval(s: IndexState | null): RetrievalPlan {
  if (s === null) return { gen: null, restrict: null }
  if (isConsistent(s)) return { gen: s.active_gen, restrict: null }
  // FTS 跟得上 active 而向量没跟上(典型:--no-vectors 重建过)→ 只用 BM25
  if (s.fts_gen === s.active_gen) return { gen: s.active_gen, restrict: 'bm25' }
  // 反过来(典型:单独跑了 reindex,只换了 FTS)→ 只用向量
  return { gen: s.active_gen, restrict: 'vector' }
}
