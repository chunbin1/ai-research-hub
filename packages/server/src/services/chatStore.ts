// packages/server/src/services/chatStore.ts
import type { DB } from './db.js'

export interface ChatMessageRow {
  id: string
  user_id: string
  doc_id: string
  role: 'user' | 'assistant'
  content: string
  sources_json: string | null
  seq: number
  created_at: string
}

let _db: DB | null = null

export function initChatTable(db: DB): void {
  _db = db
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      doc_id       TEXT NOT NULL,
      role         TEXT NOT NULL,
      content      TEXT NOT NULL,
      sources_json TEXT,
      seq          INTEGER NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_user_doc ON chat_messages(user_id, doc_id, seq);
  `)
}

function db(): DB {
  if (!_db) throw new Error('chatStore not initialized — call initChatTable() first')
  return _db
}

function genId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function appendMessage(
  userId: string,
  docId: string,
  m: { role: 'user' | 'assistant'; content: string; sources?: unknown },
): void {
  const seqRow = db()
    .prepare('SELECT COALESCE(MAX(seq) + 1, 0) AS next FROM chat_messages WHERE user_id = ? AND doc_id = ?')
    .get(userId, docId) as { next: number }
  db().prepare(
    `INSERT INTO chat_messages (id, user_id, doc_id, role, content, sources_json, seq, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    genId(), userId, docId, m.role, m.content,
    m.sources === undefined ? null : JSON.stringify(m.sources),
    seqRow.next, new Date().toISOString(),
  )
}

export function getMessages(userId: string, docId: string): ChatMessageRow[] {
  return db()
    .prepare('SELECT * FROM chat_messages WHERE user_id = ? AND doc_id = ? ORDER BY seq ASC')
    .all(userId, docId) as ChatMessageRow[]
}
