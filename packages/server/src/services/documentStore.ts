// packages/server/src/services/documentStore.ts
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './db.js'
import type { Document } from '../types.js'
import { initVersionTable } from './versionStore.js'

const RAW_DIR = process.env.RAW_DIR ?? 'data/raw'
let _db: DB | null = null

export function initDocumentTable(db: DB): void {
  _db = db
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id          TEXT PRIMARY KEY,
      filename    TEXT NOT NULL,
      size_bytes  INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      created_at  TEXT NOT NULL
    );
  `)
  // 列表要带出最新版本号,两张表总是一起建。
  initVersionTable(db)
}

function db(): DB {
  if (!_db) throw new Error('documentStore not initialized — call initDocumentTable() first')
  return _db
}

function genId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

type DocSummary = { filename: string; size_bytes: number; chunk_count: number }

/** 只建 documents 行。版本记录由 documentVersion.createVersion 负责。 */
export function saveDocument(opts: DocSummary): Document {
  const id = genId()
  const created_at = new Date().toISOString()
  db().prepare(
    'INSERT INTO documents (id, filename, size_bytes, chunk_count, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, opts.filename, opts.size_bytes, opts.chunk_count, created_at)
  return { id, ...opts, created_at, latest_version: 1, updated_at: created_at }
}

/** 新版本落地后,把 documents 行刷成最新版的摘要。created_at 不动 —— 那是文档首次上传的时间。 */
export function updateDocumentSummary(id: string, s: DocSummary): void {
  db().prepare('UPDATE documents SET filename = ?, size_bytes = ?, chunk_count = ? WHERE id = ?')
    .run(s.filename, s.size_bytes, s.chunk_count, id)
}

// 最新版本号与更新时间从版本表派生,不在 documents 里冗余存一份。
const SELECT_DOC = `
  SELECT d.*,
    COALESCE(v.version, 1)            AS latest_version,
    COALESCE(v.created_at, d.created_at) AS updated_at
  FROM documents d
  LEFT JOIN document_versions v
    ON v.doc_id = d.id
   AND v.version = (SELECT MAX(version) FROM document_versions WHERE doc_id = d.id)
`

export function getAllDocuments(): Document[] {
  return db().prepare(`${SELECT_DOC} ORDER BY d.created_at DESC`).all() as Document[]
}

export function getDocument(id: string): Document | null {
  return (db().prepare(`${SELECT_DOC} WHERE d.id = ?`).get(id) as Document) ?? null
}

export function deleteDocument(id: string): void {
  db().prepare('DELETE FROM documents WHERE id = ?').run(id)
}

export function saveRawMarkdown(id: string, md: string): void {
  mkdirSync(RAW_DIR, { recursive: true })
  writeFileSync(join(RAW_DIR, `${id}.md`), md, 'utf8')
}

export function readRawMarkdown(id: string): string | null {
  const p = join(RAW_DIR, `${id}.md`)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

export function deleteRawMarkdown(id: string): void {
  const p = join(RAW_DIR, `${id}.md`)
  if (existsSync(p)) rmSync(p)
  rmSync(versionDir(id), { recursive: true, force: true })
}

// ── 版本原文 ──────────────────────────────────────────────────────────────
//
// 每个版本一份,写入后不再改:data/raw/versions/{id}/v{n}.md。
// data/raw/{id}.md 继续作为**最新版镜像** —— import:raw、评测出题、自选股抽取
// 都读它,不用知道版本的存在。import:raw 只扫 data/raw 下的 .md 文件,
// versions/ 子目录不会被误当成文档。

function versionDir(id: string): string {
  return join(RAW_DIR, 'versions', id)
}

export function saveVersionMarkdown(id: string, version: number, md: string): void {
  mkdirSync(versionDir(id), { recursive: true })
  writeFileSync(join(versionDir(id), `v${version}.md`), md, 'utf8')
}

export function readVersionMarkdown(id: string, version: number): string | null {
  const p = join(versionDir(id), `v${version}.md`)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

/** 磁盘上已有的版本号,从小到大。迁移时用来认领从别处拷来的版本文件。 */
export function listVersionFiles(id: string): number[] {
  if (!existsSync(versionDir(id))) return []
  return readdirSync(versionDir(id))
    .map(f => /^v(\d+)\.md$/.exec(f)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b)
}
