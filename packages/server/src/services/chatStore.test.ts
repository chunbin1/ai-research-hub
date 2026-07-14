import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initChatTable, appendMessage, getMessages } from './chatStore.ts'

test('按 user+doc 存取,seq 递增,互相隔离', () => {
  const db = new Database(':memory:')
  initChatTable(db)
  appendMessage('u1', 'docA', { role: 'user', content: '问题1' })
  appendMessage('u1', 'docA', { role: 'assistant', content: '回答1', sources: [{ s: 1 }] })
  appendMessage('u1', 'docB', { role: 'user', content: '别的报告' })
  appendMessage('u2', 'docA', { role: 'user', content: '别人的' })

  const a = getMessages('u1', 'docA')
  assert.equal(a.length, 2)
  assert.equal(a[0].seq, 0)
  assert.equal(a[1].seq, 1)
  assert.equal(a[1].role, 'assistant')
  assert.equal(a[1].sources_json, JSON.stringify([{ s: 1 }]))
  assert.equal(getMessages('u1', 'docB').length, 1)  // 按 doc 隔离
  assert.equal(getMessages('u2', 'docA').length, 1)  // 按 user 隔离
})
