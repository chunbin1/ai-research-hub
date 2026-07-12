// packages/server/src/services/documentStore.ts
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './db.js'
import type { Document } from '../types.js'

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
}

function db(): DB {
  if (!_db) throw new Error('documentStore not initialized — call initDocumentTable() first')
  return _db
}

function genId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function saveDocument(opts: { filename: string; size_bytes: number; chunk_count: number }): Document {
  const id = genId()
  const created_at = new Date().toISOString()
  db().prepare(
    'INSERT INTO documents (id, filename, size_bytes, chunk_count, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, opts.filename, opts.size_bytes, opts.chunk_count, created_at)
  return { id, ...opts, created_at }
}

export function getAllDocuments(): Document[] {
  return db().prepare('SELECT * FROM documents ORDER BY created_at DESC').all() as Document[]
}

export function getDocument(id: string): Document | null {
  return (db().prepare('SELECT * FROM documents WHERE id = ?').get(id) as Document) ?? null
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
}
