// 「未初始化返回 null」这条必须是本文件的第一个 test:模块级 _db 一旦被
// initSiteSettingsTable 设上就不会再变回 null,后面的测试无法复现该状态。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initSiteSettingsTable,
  getSetting,
  setSetting,
  deleteSetting,
  DEFAULT_MODEL_KEY,
} from './siteSettingsStore.ts'

test('未初始化时 getSetting 返回 null 而不是抛错', () => {
  assert.equal(getSetting(DEFAULT_MODEL_KEY), null)
})

test('未初始化时 setSetting 抛错', () => {
  assert.throws(() => setSetting(DEFAULT_MODEL_KEY, 'glm-4.7-flash'), /not initialized/)
})

function freshDb() {
  const db = new Database(':memory:')
  initSiteSettingsTable(db)
  return db
}

test('写入后读得回来', () => {
  freshDb()
  setSetting(DEFAULT_MODEL_KEY, 'glm-4.7-flash')
  assert.equal(getSetting(DEFAULT_MODEL_KEY), 'glm-4.7-flash')
})

test('重复写入同一个 key 是覆盖,不是插入两行', () => {
  const db = freshDb()
  setSetting(DEFAULT_MODEL_KEY, 'glm-4.7-flash')
  setSetting(DEFAULT_MODEL_KEY, 'glm-4.6')
  assert.equal(getSetting(DEFAULT_MODEL_KEY), 'glm-4.6')
  const count = db.prepare('SELECT COUNT(*) AS n FROM site_settings').get() as { n: number }
  assert.equal(count.n, 1)
})

test('删除后回到 null', () => {
  freshDb()
  setSetting(DEFAULT_MODEL_KEY, 'glm-4.7-flash')
  deleteSetting(DEFAULT_MODEL_KEY)
  assert.equal(getSetting(DEFAULT_MODEL_KEY), null)
})

test('删除不存在的 key 不抛错', () => {
  freshDb()
  assert.doesNotThrow(() => deleteSetting('nope'))
})

test('没写过的 key 返回 null', () => {
  freshDb()
  assert.equal(getSetting('nope'), null)
})
