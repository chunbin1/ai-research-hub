// 清空本地开发数据:提问记录 / trace。文档、自选股、用户、评估结果一律不动。
//
// 用法(在 packages/server 下,或用根目录的 pnpm reset:dev):
//   pnpm reset:dev                  预演:只打印将删除什么,不动数据
//   pnpm reset:dev --yes            执行(默认自动备份)
//   pnpm reset:dev --chat --yes     只清提问记录
//   pnpm reset:dev --traces --yes   只清 trace
//   pnpm reset:dev --yes --no-backup
//
// 数据库路径取 DB_PATH,默认 data/research.db —— 与服务端同源。

import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { RESET_SCOPES, planReset, applyReset, type ResetScope } from '../src/services/devReset.js'

const args = new Set(process.argv.slice(2))
const DB_PATH = process.env.DB_PATH ?? 'data/research.db'

// 默认全清;点名了就只清点到的。
const named = (Object.keys(RESET_SCOPES) as ResetScope[]).filter(s => args.has(`--${s}`))
const scopes: ResetScope[] = named.length ? named : (Object.keys(RESET_SCOPES) as ResetScope[])

const unknown = [...args].filter(a => !['--yes', '--no-backup', '--force', ...Object.keys(RESET_SCOPES).map(s => `--${s}`)].includes(a))
if (unknown.length) {
  console.error(`未知参数: ${unknown.join(' ')}`)
  process.exit(1)
}

// 这个脚本是给本地开发用的。线上要清数据得显式 --force,避免手滑。
if (process.env.NODE_ENV === 'production' && !args.has('--force')) {
  console.error('NODE_ENV=production —— 拒绝执行。确实要清生产数据请加 --force。')
  process.exit(1)
}

if (!existsSync(DB_PATH)) {
  console.error(`数据库不存在: ${DB_PATH}(在 packages/server 下运行,或设 DB_PATH)`)
  process.exit(1)
}

const db = new Database(DB_PATH)
const plan = planReset(db, scopes)
const total = plan.reduce((n, p) => n + p.rows, 0)

console.log(`数据库: ${DB_PATH}`)
console.log(`范围  : ${scopes.join(', ')}\n`)
for (const p of plan) console.log(`  ${p.table.padEnd(14)} ${String(p.rows).padStart(5)} 行`)
console.log(`  ${'合计'.padEnd(13)} ${String(total).padStart(5)} 行\n`)

if (!args.has('--yes')) {
  console.log('预演模式,未做任何修改。确认无误后加 --yes 执行。')
  process.exit(0)
}

if (total === 0) {
  console.log('没有可删除的行,跳过。')
  process.exit(0)
}

// 备份放在删除之前 —— 删完再备份就没意义了。
// VACUUM INTO 出的是一致性快照,含 WAL 里尚未 checkpoint 的内容;直接 cp 文件会漏。
if (!args.has('--no-backup')) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const dest = `${DB_PATH}.bak-${stamp}`
  db.prepare('VACUUM INTO ?').run(dest)
  console.log(`已备份: ${dest}`)
}

const done = applyReset(db, scopes)
for (const d of done) console.log(`  已清空 ${d.table.padEnd(14)} ${String(d.rows).padStart(5)} 行`)
console.log('\n完成。前端需要刷新页面才会看到变化。')
