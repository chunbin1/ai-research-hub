// packages/server/src/services/devReset.ts
//
// 本地开发用的数据清理:清空提问记录 / trace,不碰文档、自选股、用户。
// CLI 在 scripts/reset-dev-data.mjs,这里只放可测的纯逻辑。
//
// 生产环境不会引用本模块 —— 只有 CLI 和测试导入它。

import type { DB } from './db.js'

/**
 * 每个 scope 对应要清空的表,**顺序即删除顺序**。
 * trace_spans 必须排在 traces 前面:它有 FOREIGN KEY 指向 traces,
 * 开启 foreign_keys 时先删父表会被约束拒绝。
 */
export const RESET_SCOPES = {
  chat: ['chat_messages'],
  traces: ['trace_spans', 'traces'],
} as const

export type ResetScope = keyof typeof RESET_SCOPES

export interface TableRows {
  table: string
  rows: number
}

function tablesFor(scopes: readonly ResetScope[]): string[] {
  const out: string[] = []
  for (const s of scopes) {
    const tables = RESET_SCOPES[s]
    if (!tables) throw new Error(`未知 scope: ${String(s)};可选:${Object.keys(RESET_SCOPES).join(', ')}`)
    out.push(...tables)
  }
  return out
}

function countRows(db: DB, table: string): number {
  return (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n
}

/** 只统计将被清空的表和行数,不做任何修改 —— 给 CLI 的 dry-run 用。 */
export function planReset(db: DB, scopes: readonly ResetScope[]): TableRows[] {
  return tablesFor(scopes).map(table => ({ table, rows: countRows(db, table) }))
}

/**
 * 在**单个事务**里清空这些表,返回各表实际删除的行数。
 * 事务是必需的:中途失败(比如表不存在)时整体回滚,不会留下删了一半的库。
 */
export function applyReset(db: DB, scopes: readonly ResetScope[]): TableRows[] {
  const tables = tablesFor(scopes)
  return db.transaction(() =>
    tables.map(table => ({ table, rows: db.prepare(`DELETE FROM ${table}`).run().changes })),
  )()
}
