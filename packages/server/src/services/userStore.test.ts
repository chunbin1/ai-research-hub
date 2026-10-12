import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initUserTables,
  tryReserveMessage,
  refundMessage,
  MESSAGE_LIMIT,
  upsertGithubUser,
  upsertGoogleUser,
} from './userStore.ts'

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

test('upsertGoogleUser 首次插入,再次登录只更新邮箱和头像', () => {
  const db = new Database(':memory:')
  initUserTables(db)
  const first = upsertGoogleUser({ googleSub: 'sub-1', email: 'a@gmail.com', avatarUrl: 'https://img/a' })
  assert.equal(first.username, 'a@gmail.com')
  assert.equal(first.github_id, null)
  assert.equal(first.google_sub, 'sub-1')
  assert.equal(first.message_count, 0)

  db.prepare('UPDATE users SET message_count = 3, is_admin = 1 WHERE id = ?').run(first.id)
  const second = upsertGoogleUser({ googleSub: 'sub-1', email: 'b@gmail.com', avatarUrl: null })
  assert.equal(second.id, first.id)
  assert.equal(second.username, 'b@gmail.com')
  assert.equal(second.avatar_url, null)
  assert.equal(second.message_count, 3)
  assert.equal(second.is_admin, 1)
  assert.equal(second.unlimited, 0)
})

test('GitHub 与 Google 账号互不影响', () => {
  const db = new Database(':memory:')
  initUserTables(db)
  const github = upsertGithubUser({ githubId: 42, username: 'lee', avatarUrl: null })
  const google = upsertGoogleUser({ googleSub: 'sub-1', email: 'lee@gmail.com', avatarUrl: null })
  assert.notEqual(github.id, google.id)
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  assert.equal(row.n, 2)
})

test('老库迁移后 github_id 可空,原用户还在', () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE users (
      id            TEXT PRIMARY KEY,
      github_id     INTEGER UNIQUE NOT NULL,
      username      TEXT NOT NULL,
      avatar_url    TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      unlimited     INTEGER NOT NULL DEFAULT 0,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );
  `)
  db.prepare(
    `INSERT INTO users (id, github_id, username, avatar_url, message_count, unlimited, is_admin, created_at)
     VALUES ('usr_old', 7, 'lee', NULL, 4, 1, 1, '2026-01-01')`,
  ).run()

  initUserTables(db)

  const cols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string; notnull: number }>
  assert.equal(cols.find(c => c.name === 'github_id')?.notnull, 0)
  assert.ok(cols.some(c => c.name === 'google_sub'))
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get('usr_old') as {
    github_id: number
    google_sub: string | null
    username: string
    message_count: number
    is_admin: number
    unlimited: number
  }
  assert.equal(row.github_id, 7)
  assert.equal(row.google_sub, null)
  assert.equal(row.username, 'lee')
  assert.equal(row.message_count, 4)
  assert.equal(row.is_admin, 1)
  assert.equal(row.unlimited, 1)
})

test('两个身份都空的行插不进去', () => {
  const db = new Database(':memory:')
  initUserTables(db)
  assert.throws(() => {
    db.prepare(
      `INSERT INTO users (id, github_id, google_sub, username, avatar_url, message_count, unlimited, is_admin, created_at)
       VALUES ('usr_x', NULL, NULL, 'n', NULL, 0, 0, 0, '2026-01-01')`,
    ).run()
  })
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
