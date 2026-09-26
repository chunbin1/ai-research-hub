// packages/server/src/services/migrations.ts
//
// 一次性数据迁移的执行记录。
//
// 修历史数据的逻辑如果写成「每次启动都跑一遍」,它就悄悄变成了一条长期规则:
// 以后哪天有正当理由让数据偏离这条规则,下次启动就会被改回去,而且没人知道。
// 所以数据修复一律走 runOnce:跑过就记下名字,之后再也不碰。

import type { DB } from './db.js'

export function initMigrationTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applied_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)
}

/**
 * 名为 `name` 的迁移没跑过就跑一次,返回它的结果;跑过了返回 null。
 *
 * 迁移本身和「记下已执行」在同一个事务里:中途失败就整体回滚,下次启动重来,
 * 不会出现改了一半却被记成已执行的情况。`name` 一旦上线就不要改 —— 改了等于新迁移。
 */
export function runOnce<T>(db: DB, name: string, migrate: () => T): T | null {
  initMigrationTable(db)
  return db.transaction(() => {
    const done = db.prepare('SELECT 1 FROM applied_migrations WHERE name = ?').get(name)
    if (done) return null
    const result = migrate()
    db.prepare('INSERT INTO applied_migrations (name, applied_at) VALUES (?, ?)')
      .run(name, new Date().toISOString())
    return result
  })()
}
