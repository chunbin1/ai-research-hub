// packages/server/src/services/siteSettingsStore.ts
//
// 站点级设置的通用键值表。目前只有一个 key:default_model —— 站点默认模型名,
// 优先级高于 .env 里的 ZHIPU_MODEL / ANTHROPIC_MODEL。
//
// getSetting 在未初始化时返回 null 而不是抛错,这一点和 llmConfigStore 的
// 约定相反,是刻意的:serverLLMConfig() 会在不建库的单元测试(llm.test.ts)里
// 被直接调用,抛错会让那些测试全部失败。返回 null 则天然回落到环境变量。
// 写操作没有这个顾虑,未初始化就抛。
import type { DB } from './db.js'

export const DEFAULT_MODEL_KEY = 'default_model'

let _db: DB | null = null

export function initSiteSettingsTable(db: DB): void {
  _db = db
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

function requireDb(): DB {
  if (!_db) throw new Error('siteSettingsStore not initialized — call initSiteSettingsTable() first')
  return _db
}

export function getSetting(key: string): string | null {
  if (!_db) return null
  const row = _db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  const now = new Date().toISOString()
  requireDb().prepare(`
    INSERT INTO site_settings (key, value, updated_at)
    VALUES (@key, @value, @updated_at)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run({ key, value, updated_at: now })
}

export function deleteSetting(key: string): void {
  requireDb().prepare('DELETE FROM site_settings WHERE key = ?').run(key)
}
