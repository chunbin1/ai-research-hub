// packages/server/src/services/db.ts
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type DB = Database.Database

const DB_PATH = process.env.DB_PATH ?? 'data/research.db'

let _db: DB | null = null

export function initDb(): DB {
  if (_db) return _db
  mkdirSync(dirname(DB_PATH), { recursive: true })
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  return _db
}

export function getDb(): DB {
  if (!_db) throw new Error('db not initialized — call initDb() first')
  return _db
}
