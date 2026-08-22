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

const { initWatchlistTable, addWatchlistEntry, updateScanResult, listWatchlist, softDeleteWatchlistEntry } =
  await import('../services/watchlistStore.ts')
const { initSignalTables, replaceStates, replaceEvents, getLatestState, getLatestEvent } =
  await import('../services/signalStore.ts')
const { initSiteSettingsTable } = await import('../services/siteSettingsStore.ts')
const { initDocumentTable, saveRawMarkdown } = await import('../services/documentStore.ts')
const { signalRoutes } = await import('./signals.ts')

async function freshApp(probe?: unknown) {
  const db = new Database(':memory:')
  initWatchlistTable(db); initSignalTables(db); initSiteSettingsTable(db); initDocumentTable(db)
  const app = fastify()
  await app.register(signalRoutes, {
    prefix: '/api',
    scan: async () => ({ total: 2, ok: 2, failed: 0, insufficient: 0 }),
    probe: (probe ?? (async () => ({
      symbol: 'RKLB', market: 'US', name: 'Rocket Lab Corporation', currency: 'USD',
      exchange: 'NasdaqGS', bars: 1218, enough: true, alreadyListed: false, deleted: false,
    }))) as never,
  })
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

test('POST /signals/watchlist/probe 返回公司身份', async () => {
  const { app } = await freshApp()
  const res = await app.inject({ method: 'POST', url: '/api/signals/watchlist/probe', payload: { code: 'RKLB' } })
  assert.equal(res.statusCode, 200)
  const b = res.json()
  assert.equal(b.symbol, 'RKLB')
  assert.equal(b.name, 'Rocket Lab Corporation')
  assert.equal(b.exchange, 'NasdaqGS')
  assert.equal(b.enough, true)
})

test('probe 的 code 必须是非空字符串', async () => {
  const { app } = await freshApp()
  for (const payload of [{}, { code: '' }, { code: '   ' }, { code: 123 }]) {
    const res = await app.inject({ method: 'POST', url: '/api/signals/watchlist/probe', payload })
    assert.equal(res.statusCode, 400, `payload ${JSON.stringify(payload)} 应该 400`)
  }
})

test('probe 失败时把 ProbeError 的 kind 与文案透传出去', async () => {
  const { ProbeError } = await import('../services/signals/probeSymbol.ts')
  const { app } = await freshApp(async () => { throw new ProbeError('只支持美股与港股', 'unsupported_market') })
  const res = await app.inject({ method: 'POST', url: '/api/signals/watchlist/probe', payload: { code: '002466' } })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'unsupported_market')
  assert.match(res.json().message, /只支持美股与港股/)
})

test('POST /signals/watchlist 新增标的,来源为空表示手动添加', async () => {
  const { app } = await freshApp()
  const res = await app.inject({ method: 'POST', url: '/api/signals/watchlist', payload: { symbol: 'RKLB', market: 'US' } })
  assert.equal(res.statusCode, 200)
  const e = listWatchlist()[0]
  assert.equal(e.symbol, 'RKLB')
  assert.equal(e.market, 'US')
  assert.equal(e.source_doc, null)
  assert.equal(e.source_text, null)
})

test('POST /signals/watchlist 复活已删除的标的', async () => {
  const { app } = await freshApp()
  addWatchlistEntry({ symbol: 'RKLB', market: 'US', sourceDoc: 'doc_1', sourceText: '来自研报' })
  updateScanResult('RKLB', { status: 'invalid', lastError: '旧的失败', lastScanAt: 'a' })
  softDeleteWatchlistEntry('RKLB')
  assert.deepEqual(listWatchlist(), [])

  const res = await app.inject({ method: 'POST', url: '/api/signals/watchlist', payload: { symbol: 'RKLB', market: 'US' } })
  assert.equal(res.statusCode, 200)
  const e = listWatchlist()[0]
  assert.equal(e.symbol, 'RKLB')
  assert.equal(e.status, 'ok')
  assert.equal(e.last_error, null)
  assert.equal(e.source_doc, 'doc_1', '复活保留原来的来源,不该被抹成手动添加')
})

test('POST /signals/watchlist 重复添加返回 409', async () => {
  const { app } = await freshApp()
  addWatchlistEntry({ symbol: 'RKLB', market: 'US', sourceDoc: null, sourceText: null })
  const res = await app.inject({ method: 'POST', url: '/api/signals/watchlist', payload: { symbol: 'RKLB', market: 'US' } })
  assert.equal(res.statusCode, 409)
})

test('POST /signals/watchlist 校验入参', async () => {
  const { app } = await freshApp()
  for (const payload of [{}, { symbol: 'RKLB' }, { symbol: '', market: 'US' }, { symbol: 'RKLB', market: 'CN' }]) {
    const res = await app.inject({ method: 'POST', url: '/api/signals/watchlist', payload })
    assert.equal(res.statusCode, 400, `payload ${JSON.stringify(payload)} 应该 400`)
  }
})

test('DELETE 软删除并清掉两个周期的日志与事件', async () => {
  const { app, db } = await freshApp(); seedALB(db)
  assert.ok(getLatestState('ALB', '1d'))
  assert.ok(getLatestState('ALB', '1wk'))
  assert.ok(getLatestEvent('ALB', '1d'))

  const res = await app.inject({ method: 'DELETE', url: '/api/signals/watchlist/ALB' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(listWatchlist(), [], '删除后不再出现在列表里')
  assert.equal(getLatestState('ALB', '1d'), null)
  assert.equal(getLatestState('ALB', '1wk'), null)
  assert.equal(getLatestEvent('ALB', '1d'), null)
  assert.equal(getLatestEvent('ALB', '1wk'), null)
})

test('DELETE 不存在的标的返回 404', async () => {
  const { app } = await freshApp()
  const res = await app.inject({ method: 'DELETE', url: '/api/signals/watchlist/NOPE' })
  assert.equal(res.statusCode, 404)
})
