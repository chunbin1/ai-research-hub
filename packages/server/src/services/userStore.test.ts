import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initUserTables, tryReserveMessage, refundMessage, MESSAGE_LIMIT } from './userStore.ts'

function seedUser(db: Database.Database, p: { id: string; messageCount: number; unlimited?: number; isAdmin?: number }) {
  db.prepare(
    `INSERT INTO users (id, github_id, username, avatar_url, message_count, unlimited, is_admin, created_at)
     VALUES (@id, @github_id, @username, @avatar_url, @message_count, @unlimited, @is_admin, @created_at)`,
  ).run({
    id: p.id,
    github_id: Math.floor(Math.random() * 1e9),
    username: p.id,
    avatar_url: null,
    message_count: p.messageCount,
    unlimited: p.unlimited ?? 0,
    is_admin: p.isAdmin ?? 0,
    created_at: new Date().toISOString(),
  })
}

test('tryReserveMessage:原子占用,达到上限后拒绝,refundMessage 归还', () => {
  const db = new Database(':memory:')
  initUserTables(db)
  seedUser(db, { id: 'u1', messageCount: MESSAGE_LIMIT - 1 })

  assert.equal(tryReserveMessage('u1'), true) // 占用后达到上限
  const row1 = db.prepare('SELECT message_count FROM users WHERE id = ?').get('u1') as { message_count: number }
  assert.equal(row1.message_count, MESSAGE_LIMIT)

  assert.equal(tryReserveMessage('u1'), false) // 已达上限,拒绝
  const row2 = db.prepare('SELECT message_count FROM users WHERE id = ?').get('u1') as { message_count: number }
  assert.equal(row2.message_count, MESSAGE_LIMIT) // 拒绝时计数不变

  refundMessage('u1')
  const row3 = db.prepare('SELECT message_count FROM users WHERE id = ?').get('u1') as { message_count: number }
  assert.equal(row3.message_count, MESSAGE_LIMIT - 1)
})

test('refundMessage 不应低于 0', () => {
  const db = new Database(':memory:')
  initUserTables(db)
  seedUser(db, { id: 'u2', messageCount: 0 })
  refundMessage('u2')
  const row = db.prepare('SELECT message_count FROM users WHERE id = ?').get('u2') as { message_count: number }
  assert.equal(row.message_count, 0)
})

test('unlimited 用户 tryReserveMessage 始终返回 true(且仍计数,无害)', () => {
  const db = new Database(':memory:')
  initUserTables(db)
  seedUser(db, { id: 'u3', messageCount: MESSAGE_LIMIT, unlimited: 1 })

  assert.equal(tryReserveMessage('u3'), true)
  assert.equal(tryReserveMessage('u3'), true)
  const row = db.prepare('SELECT message_count FROM users WHERE id = ?').get('u3') as { message_count: number }
  assert.equal(row.message_count, MESSAGE_LIMIT + 2)
})
