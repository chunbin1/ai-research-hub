// packages/server/src/services/indexState.ts
//
// 每个**版本**的索引代次状态。它是两路索引的**唯一真相**:查询按 active_gen 过滤
// 向量,重建按它判断该跳过还是该干活。
//
// 三个代次分开记,因为它们会在重建过程中短暂地不一致:
//
//   vec_gen     已经写完**并且验证过**的那批向量的代次
//   fts_gen     FTS 表里那批行的代次
//   active_gen  查询实际使用的代次 —— 只有两路都就位才翻到新代
//
// 翻转 active_gen 是单条 UPDATE,和 FTS 的重建放在同一个事务里。所以任何时刻
// 从外面看过去,一个版本要么整个是旧代、要么整个是新代,没有中间态。
//
// 一篇文档的各个版本共用同一批按代次存的索引:两个版本切块相同,代次就相同,
// 索引自然共享。所以回收旧代之前要看它还有没有被别的版本引用(isGenReferenced)。

import type { DB } from './db.js'

export interface IndexState {
  doc_id: string
  version: number
  active_gen: string
  vec_gen: string
  fts_gen: string
  embed_model: string
  updated_at: string
}

const CREATE = `
  CREATE TABLE IF NOT EXISTS doc_index_state (
    doc_id      TEXT NOT NULL,
    version     INTEGER NOT NULL,
    active_gen  TEXT NOT NULL,
    vec_gen     TEXT NOT NULL,
    fts_gen     TEXT NOT NULL,
    embed_model TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (doc_id, version)
  );
`

export function initIndexStateTable(db: DB): void {
  const cols = (db.prepare('PRAGMA table_info(doc_index_state)').all() as Array<{ name: string }>).map(c => c.name)
  if (cols.length > 0 && !cols.includes('version')) {
    // 版本化之前是每篇一行,那一行就是 v1 的状态。SQLite 改不了主键,
    // 只能建新表搬过去;放在一个事务里,中途失败不会丢状态。
    db.transaction(() => {
      db.exec('ALTER TABLE doc_index_state RENAME TO doc_index_state_old')
      db.exec(CREATE)
      db.exec(`
        INSERT INTO doc_index_state (doc_id, version, active_gen, vec_gen, fts_gen, embed_model, updated_at)
        SELECT doc_id, 1, active_gen, vec_gen, fts_gen, embed_model, updated_at FROM doc_index_state_old
      `)
      db.exec('DROP TABLE doc_index_state_old')
    })()
    console.info('[indexState] 已迁移为按版本记录,存量状态记为 v1')
    return
  }
  db.exec(CREATE)
}

/**
 * 没有行 = 这个版本还没被代次化(代次机制上线之前建的索引)。
 *
 * 调用方必须把 null 当作「legacy 模式:查询不加代次过滤」,而不是当作错误 ——
 * 部署完到第一次重建之间,全库都是这个状态,站点必须照常工作。
 */
export function getIndexState(db: DB, docId: string, version: number): IndexState | null {
  return (db.prepare('SELECT * FROM doc_index_state WHERE doc_id = ? AND version = ?')
    .get(docId, version) as IndexState) ?? null
}

export function listIndexState(db: DB): IndexState[] {
  return db.prepare('SELECT * FROM doc_index_state ORDER BY doc_id, version').all() as IndexState[]
}

/** 整行写入 —— 重建成功翻转时用,三个代次一起落地。 */
export function putIndexState(
  db: DB,
  s: Omit<IndexState, 'updated_at'> & { updated_at?: string },
): void {
  db.prepare(`
    INSERT INTO doc_index_state (doc_id, version, active_gen, vec_gen, fts_gen, embed_model, updated_at)
    VALUES (@doc_id, @version, @active_gen, @vec_gen, @fts_gen, @embed_model, @updated_at)
    ON CONFLICT(doc_id, version) DO UPDATE SET
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
export function setFtsGen(db: DB, docId: string, version: number, gen: string): void {
  db.prepare('UPDATE doc_index_state SET fts_gen = ?, updated_at = ? WHERE doc_id = ? AND version = ?')
    .run(gen, new Date().toISOString(), docId, version)
}

/** 删掉这篇所有版本的状态 —— 删除文档时用。 */
export function deleteIndexState(db: DB, docId: string): void {
  db.prepare('DELETE FROM doc_index_state WHERE doc_id = ?').run(docId)
}

/**
 * 这一代还有没有被本篇的**其他版本**用着(任何一路)。
 *
 * 回收旧代前必须问一句:两个版本内容相同时共用同一代索引,删掉就把另一个
 * 版本的检索打空了。
 */
export function isGenReferenced(db: DB, docId: string, gen: string, exceptVersion: number): boolean {
  return db.prepare(`
    SELECT 1 FROM doc_index_state
    WHERE doc_id = ? AND version != ? AND (active_gen = ? OR vec_gen = ? OR fts_gen = ?)
    LIMIT 1
  `).get(docId, exceptVersion, gen, gen, gen) !== undefined
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
