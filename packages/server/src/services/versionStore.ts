// packages/server/src/services/versionStore.ts
//
// 文档的版本清单:每篇有哪些版本、各自是什么时候、为什么更新的。
//
// 这是给人看的业务数据,写入后不再变。索引建到哪一步是另一回事,归
// doc_index_state 管 —— 那张表重建时会反复改写,两者分开放,重建索引就不会
// 碰到更新说明和上传时间。
//
// `documents` 表仍然每篇一行,代表**最新版**的摘要,列表页不必知道版本的存在。

import type { DB } from './db.js'
import type { DocumentVersion } from '../types.js'

export function initVersionTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_versions (
      doc_id      TEXT NOT NULL,
      version     INTEGER NOT NULL,
      filename    TEXT NOT NULL,
      size_bytes  INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      note        TEXT,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (doc_id, version)
    );
  `)
}

/** 从旧到新。 */
export function listVersions(db: DB, docId: string): DocumentVersion[] {
  return db.prepare('SELECT * FROM document_versions WHERE doc_id = ? ORDER BY version')
    .all(docId) as DocumentVersion[]
}

export function getVersion(db: DB, docId: string, version: number): DocumentVersion | null {
  return (db.prepare('SELECT * FROM document_versions WHERE doc_id = ? AND version = ?')
    .get(docId, version) as DocumentVersion) ?? null
}

/** 没有任何版本时返回 null。 */
export function latestVersion(db: DB, docId: string): number | null {
  const row = db.prepare('SELECT MAX(version) AS v FROM document_versions WHERE doc_id = ?')
    .get(docId) as { v: number | null }
  return row.v
}

/**
 * 该篇要处理的版本号。
 *
 * 还没迁移出版本记录的文档按 v1 处理 —— 迁移本来也是把它登记成 v1,
 * 这样测试和迁移前的脚本不必先建版本行。
 */
export function versionsOf(db: DB, docId: string): number[] {
  const vs = listVersions(db, docId).map(v => v.version)
  return vs.length ? vs : [1]
}

/**
 * 登记一个新版本,版本号取当前最大值 + 1。
 *
 * 取号和插入在同一个事务里,并发上传不会撞号。
 */
export function insertVersion(
  db: DB,
  v: Omit<DocumentVersion, 'version' | 'created_at' | 'note'> & { note?: string | null; created_at?: string },
): DocumentVersion {
  return db.transaction(() => {
    const version = (latestVersion(db, v.doc_id) ?? 0) + 1
    const row: DocumentVersion = {
      doc_id: v.doc_id,
      version,
      filename: v.filename,
      size_bytes: v.size_bytes,
      chunk_count: v.chunk_count,
      note: v.note ?? null,
      created_at: v.created_at ?? new Date().toISOString(),
    }
    db.prepare(`
      INSERT INTO document_versions (doc_id, version, filename, size_bytes, chunk_count, note, created_at)
      VALUES (@doc_id, @version, @filename, @size_bytes, @chunk_count, @note, @created_at)
    `).run(row)
    return row
  })()
}

/** 迁移用:按指定版本号登记,已存在则不动。 */
export function registerVersion(db: DB, v: DocumentVersion): void {
  db.prepare(`
    INSERT OR IGNORE INTO document_versions (doc_id, version, filename, size_bytes, chunk_count, note, created_at)
    VALUES (@doc_id, @version, @filename, @size_bytes, @chunk_count, @note, @created_at)
  `).run(v)
}

export function deleteVersions(db: DB, docId: string): void {
  db.prepare('DELETE FROM document_versions WHERE doc_id = ?').run(docId)
}
