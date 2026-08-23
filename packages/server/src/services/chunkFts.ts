// packages/server/src/services/chunkFts.ts
//
// BM25 关键词检索:混合检索的第二路,补向量的字面盲区。
//
// 向量擅长「请一天假找谁」≈「短期年假审批人」这类语义近似,但对错误码、
// 财季、股票代码、具体数字这些**精确 token** 无能为力 —— 用户搜
// ERR_AUTH_1042 时向量会返回一段讲「认证失败」的说明,漏掉真正含该错误码
// 的那块。BM25 反过来:只认字面,但认得准。
//
// 附带收益:它不调任何 API。线上曾因 embedding 配额耗尽导致检索静默返回空,
// 有了这条腿,同样的故障下检索会降级而不是归零。

import type { DB } from './db.js'
import type { MdChunk } from './markdownParser.js'

export interface Bm25Hit {
  doc_id: string
  chunk_index: number
  section_title: string
  section_slug: string
  content: string
  /** FTS5 的 bm25():**负数,越小越相关**。这里原样透出,排序已按它升序。 */
  score: number
}

/** 建表时的列集合。改这里就要同步改 EXPECTED_COLUMNS —— 否则迁移检测失效。 */
const EXPECTED_COLUMNS = ['doc_id', 'chunk_index', 'section_slug', 'section_title', 'content']

/**
 * 只负责建表;读写操作都显式收 db,避免隐式的模块级状态。
 *
 * FTS 是**派生索引** —— 原文在 data/raw/,随时能用 `pnpm reindex` 重建。
 * 所以 schema 变更时直接重建表,不需要写数据迁移。但必须真的重建:
 * `CREATE TABLE IF NOT EXISTS` 遇到列不匹配的旧表会静默跳过,之后每次
 * 查询都因缺列而报错。
 */
export function initChunkFtsTable(db: DB): void {
  const exists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chunk_fts'").get()
  if (exists) {
    const cols = (db.prepare('PRAGMA table_info(chunk_fts)').all() as Array<{ name: string }>).map(c => c.name)
    const stale = EXPECTED_COLUMNS.some(c => !cols.includes(c))
    if (!stale) return
    console.warn('[chunkFts] 索引 schema 已过时,重建空表 —— 运行 `pnpm reindex` 回填')
    db.exec('DROP TABLE chunk_fts')
  }
  // trigram 是中文唯一可用的选择 —— icu 分词器没有编进 better-sqlite3
  // (实测 `no such tokenizer: icu`),而默认的 unicode61 按空格切词,
  // 会把一整段中文当成一个巨型 token,完全不可用。
  //
  // doc_id / chunk_index / section_slug 走 UNINDEXED:它们只用于过滤和回指,
  // 不该参与全文匹配,否则 id 和 slug 里的字符会污染打分。
  // section_slug 必须存 —— 它是前端溯源回链的锚点,BM25 单路命中的块
  // 没有它,那条来源链接就是死的。
  db.exec(`
    CREATE VIRTUAL TABLE chunk_fts USING fts5(
      doc_id        UNINDEXED,
      chunk_index   UNINDEXED,
      section_slug  UNINDEXED,
      section_title,
      content,
      tokenize='trigram'
    );
  `)
}

/** 索引里的总行数。启动时用它判断是否需要自愈重建。 */
export function countChunkFts(db: DB): number {
  return (db.prepare('SELECT count(*) AS n FROM chunk_fts').get() as { n: number }).n
}

/**
 * 把用户查询转成 FTS5 的 MATCH 表达式。
 *
 * 中文没有空格,配合 trigram 分词器的办法是把查询切成所有 3-gram 再 OR 起来,
 * 让 IDF 去挑稀有的那个:「毛利率是多少」展开成
 * `"毛利率" OR "利率是" OR "率是多" OR "是多少"`,其中「毛利率」全篇只在少数
 * 块出现,权重压倒「是多少」。这样不必引入任何分词库。
 *
 * 每个 gram 必须包在双引号里 —— 裸写 `42.3` 会让 FTS5 报
 * `syntax error near "."`,而研报里满是数字和代码。
 *
 * 返回 null 表示查询不足 3 字、构造不出 trigram,调用方应退化为纯向量。
 */
export function toMatchExpr(query: string): string | null {
  const s = query.replace(/\s+/g, '')
  if (s.length < 3) return null
  const grams = new Set<string>()
  for (let i = 0; i + 3 <= s.length; i++) grams.add(s.slice(i, i + 3))
  return [...grams].map(g => `"${g.replace(/"/g, '""')}"`).join(' OR ')
}

/** 覆盖式写入:先删掉该文档的旧块,再整批插入。重复调用不会产生重复行。 */
export function upsertChunkFts(d: DB, docId: string, chunks: MdChunk[]): void {
  const insert = d.prepare(
    'INSERT INTO chunk_fts (doc_id, chunk_index, section_slug, section_title, content) VALUES (?, ?, ?, ?, ?)')
  d.transaction(() => {
    d.prepare('DELETE FROM chunk_fts WHERE doc_id = ?').run(docId)
    for (const c of chunks) insert.run(docId, c.chunk_index, c.section_slug, c.section_title, c.content)
  })()
}

export function deleteChunkFts(d: DB, docId: string): void {
  d.prepare('DELETE FROM chunk_fts WHERE doc_id = ?').run(docId)
}

/**
 * 按 BM25 相关性检索单篇文档内的块。
 *
 * doc_id 作为普通 WHERE 与 MATCH 一起下推,和向量路的 `where: {doc_id}` 一样是
 * **预过滤** —— 不能查完全库再在应用层删,否则前 K 名全是别的文档时会得到空结果。
 */
export function searchBm25(d: DB, docId: string, query: string, limit: number): Bm25Hit[] {
  const expr = toMatchExpr(query)
  if (expr === null) return []
  return d
    .prepare(`
      SELECT doc_id, chunk_index, section_slug, section_title, content, bm25(chunk_fts) AS score
      FROM chunk_fts
      WHERE doc_id = ? AND chunk_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `)
    .all(docId, expr, limit) as Bm25Hit[]
}
