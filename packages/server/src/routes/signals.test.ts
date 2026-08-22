import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// AUTH_DISABLED 必须精确等于 'true'(见 auth.ts 的 `=== 'true'`),
// 不能用 '1' 之类的真值代替 —— 否则 requireAdmin 仍会当作未登录处理。
process.env.AUTH_DISABLED = 'true'
delete process.env.SIGNALS
// documentStore 在模块顶层用 `process.env.RAW_DIR ?? 'data/raw'` 求值一次,
// 必须在下面 import 它之前把 RAW_DIR 指到一个临时目录,
// 这样 /signals/extract 测试里真实写盘的原始 markdown 不会碰到项目的 data/raw。
process.env.RAW_DIR = mkdtempSync(join(tmpdir(), 'signals-extract-'))

const { initWatchlistTable, addWatchlistEntry, updateScanResult, listWatchlist } =
  await import('../services/watchlistStore.ts')
const { initSignalTables, replaceStates, replaceEvents } = await import('../services/signalStore.ts')
const { initSiteSettingsTable } = await import('../services/siteSettingsStore.ts')
const { initDocumentTable, saveRawMarkdown } = await import('../services/documentStore.ts')
const { signalRoutes } = await import('./signals.ts')

async function freshApp() {
  const db = new Database(':memory:')
  initWatchlistTable(db); initSignalTables(db); initSiteSettingsTable(db); initDocumentTable(db)
  const app = fastify()
  await app.register(signalRoutes, { prefix: '/api', scan: async () => ({ total: 2, ok: 2, failed: 0, insufficient: 0 }) })
  await app.ready()
  return { app, db }
}

// documentStore 没有「按指定 id 插入」的导出函数(saveDocument 自己生成 id),
// 这里直接对 documentStore 建的表写一行,凑出 seedALB() 引用的 doc_1。
function seedDoc1(db: InstanceType<typeof Database>) {
  db.prepare(
    'INSERT INTO documents (id, filename, size_bytes, chunk_count, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('doc_1', 'albemarle-2026-08.md', 1024, 6, new Date().toISOString())
}

function seedALB(db: InstanceType<typeof Database>) {
  seedDoc1(db)
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'doc_1', sourceText: '5.5 Albemarle（NYSE: ALB）' })
  updateScanResult('ALB', { name: 'Albemarle Corporation', currency: 'USD', status: 'ok', lastError: null, lastScanAt: '2026-08-21T00:00:00.000Z' })
  replaceStates('ALB', '1d', [
    { symbol: 'ALB', timeframe: '1d', bar_date: '2026-08-07', trend: 1, stop_line: 110, close_adj: 131.11, close_raw: 131.11, atr: 5 },
    { symbol: 'ALB', timeframe: '1d', bar_date: '2026-08-20', trend: 1, stop_line: 119.36, close_adj: 134.19, close_raw: 134.19, atr: 5.02 },
  ])
  replaceEvents('ALB', '1d', [
    { symbol: 'ALB', timeframe: '1d', bar_date: '2026-05-18', direction: -1, price: 175.3 },
    { symbol: 'ALB', timeframe: '1d', bar_date: '2026-08-07', direction: 1, price: 131.11 },
  ])
  replaceStates('ALB', '1wk', [
    { symbol: 'ALB', timeframe: '1wk', bar_date: '2026-08-14', trend: -1, stop_line: 167.69, close_adj: 136.15, close_raw: 136.15, atr: 16.77 },
  ])
  replaceEvents('ALB', '1wk', [
    { symbol: 'ALB', timeframe: '1wk', bar_date: '2026-06-26', direction: -1, price: 133.7 },
  ])
}

test('GET /signals 返回日周状态与派生指标', async () => {
  const { app, db } = await freshApp(); seedALB(db)
  const res = await app.inject({ method: 'GET', url: '/api/signals' })
  assert.equal(res.statusCode, 200)
  const row = res.json().rows[0]
  assert.equal(row.symbol, 'ALB')
  assert.equal(row.name, 'Albemarle Corporation')
  assert.equal(row.currency, 'USD')
  assert.equal(row.closeRaw, 134.19)
  assert.equal(row.daily.trend, 1)
  assert.equal(row.daily.stopLine, 119.36)
  assert.equal(row.daily.flipDate, '2026-08-07')
  assert.equal(row.daily.flipPrice, 131.11)
  assert.equal(row.weekly.trend, -1)
  assert.equal(row.divergent, true)              // 日多周空
  assert.equal(row.sourceDoc.id, 'doc_1')
  // 距止损:(134.19 - 119.36) / 119.36 * 100
  assert.ok(Math.abs(row.daily.distPct - 12.425) < 0.01)
  // 翻转后涨跌:(134.19 - 131.11) / 131.11 * 100
  assert.ok(Math.abs(row.daily.sinceFlipPct - 2.349) < 0.01)
})

test('没有状态的票也出现在列表里,状态字段为 null', async () => {
  const { app } = await freshApp()
  addWatchlistEntry({ symbol: 'NEW', market: 'US', sourceDoc: 'd', sourceText: 't' })
  updateScanResult('NEW', { status: 'insufficient', lastError: '历史数据不足', lastScanAt: 'x' })
  const row = (await app.inject({ method: 'GET', url: '/api/signals' })).json().rows[0]
  assert.equal(row.daily, null)
  assert.equal(row.weekly, null)
  assert.equal(row.status, 'insufficient')
  assert.equal(row.lastError, '历史数据不足')
})

test('GET /signals/:symbol/log 按周期与条数返回', async () => {
  const { app, db } = await freshApp(); seedALB(db)
  const res = await app.inject({ method: 'GET', url: '/api/signals/ALB/log?timeframe=1d&limit=999' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json().states.map((s: { bar_date: string }) => s.bar_date), ['2026-08-20', '2026-08-07'])

  const wk = await app.inject({ method: 'GET', url: '/api/signals/ALB/log?timeframe=1wk&limit=999' })
  assert.equal(wk.json().states.length, 1)

  const bad = await app.inject({ method: 'GET', url: '/api/signals/ALB/log?timeframe=1h' })
  assert.equal(bad.statusCode, 400)
})

test('GET /signals/events 返回近期事件', async () => {
  const { app, db } = await freshApp(); seedALB(db)
  const res = await app.inject({ method: 'GET', url: '/api/signals/events?days=99999' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().events.length, 3)
})

test('POST /signals/scan 调用注入的 scan', async () => {
  const { app } = await freshApp()
  const res = await app.inject({ method: 'POST', url: '/api/signals/scan' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json().summary, { total: 2, ok: 2, failed: 0, insufficient: 0 })
})

test('POST /signals/extract 从磁盘上的原始 markdown 抽取标的并写入自选股', async () => {
  const { app, db } = await freshApp()
  seedDoc1(db)
  saveRawMarkdown('doc_1', [
    '# 5.5 Albemarle（NYSE: ALB）',
    '',
    '正文随便写点什么,标题以外的内容不参与抽取。',
  ].join('\n'))

  const res = await app.inject({ method: 'POST', url: '/api/signals/extract' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.documents, 1)
  assert.deepEqual(body.symbols, ['ALB'])
  assert.equal(listWatchlist().find(e => e.symbol === 'ALB')?.symbol, 'ALB')
})

test('PATCH 禁用与启用', async () => {
  const { app, db } = await freshApp(); seedALB(db)
  const off = await app.inject({ method: 'PATCH', url: '/api/signals/watchlist/ALB', payload: { enabled: false } })
  assert.equal(off.statusCode, 200)
  assert.equal(listWatchlist()[0].enabled, 0)

  const bad = await app.inject({ method: 'PATCH', url: '/api/signals/watchlist/ALB', payload: { enabled: '不是布尔' } })
  assert.equal(bad.statusCode, 400)

  const missing = await app.inject({ method: 'PATCH', url: '/api/signals/watchlist/NOPE', payload: { enabled: true } })
  assert.equal(missing.statusCode, 404)
})
