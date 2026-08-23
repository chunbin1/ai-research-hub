import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initWatchlistTable, addWatchlistEntry, listWatchlist, listScannable,
  updateScanResult, softDeleteWatchlistEntry, reviveWatchlistEntry,
} from './watchlistStore.ts'

beforeEach(() => {
  initWatchlistTable(new Database(':memory:'))
})

test('新增并读取', () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'doc_1', sourceText: '5.5 Albemarle（NYSE: ALB）' })
  const all = listWatchlist()
  assert.equal(all.length, 1)
  assert.equal(all[0].symbol, 'ALB')
  assert.equal(all[0].market, 'US')
  assert.equal(all[0].enabled, 1)
  assert.equal(all[0].status, 'ok')
  assert.equal(all[0].source_doc, 'doc_1')
  assert.equal(all[0].name, null)
})

test('重复新增保留最早一次的来源', () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'doc_1', sourceText: '第一篇' })
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'doc_2', sourceText: '第二篇' })
  const all = listWatchlist()
  assert.equal(all.length, 1)
  assert.equal(all[0].source_doc, 'doc_1')
  assert.equal(all[0].source_text, '第一篇')
})

test('扫描结果回填名称、币种与状态', () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'doc_1', sourceText: 't' })
  updateScanResult('ALB', {
    name: 'Albemarle Corporation', currency: 'USD',
    status: 'ok', lastError: null, lastScanAt: '2026-08-21T00:00:00.000Z',
  })
  const e = listWatchlist()[0]
  assert.equal(e.name, 'Albemarle Corporation')
  assert.equal(e.currency, 'USD')
  assert.equal(e.last_error, null)
  assert.equal(e.last_scan_at, '2026-08-21T00:00:00.000Z')
})

test('失败时写入 last_error,不清空已有名称', () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'd', sourceText: 't' })
  updateScanResult('ALB', { name: 'Albemarle', currency: 'USD', status: 'ok', lastError: null, lastScanAt: 'a' })
  updateScanResult('ALB', { status: 'ok', lastError: '被限流', lastScanAt: 'b' })
  const e = listWatchlist()[0]
  assert.equal(e.name, 'Albemarle')      // 不传 name 就不动它
  assert.equal(e.last_error, '被限流')
})

test('listScannable 排除已删除与 invalid', () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'd', sourceText: 't' })
  addWatchlistEntry({ symbol: 'SQM', market: 'US', sourceDoc: 'd', sourceText: 't' })
  addWatchlistEntry({ symbol: '9696.HK', market: 'HK', sourceDoc: 'd', sourceText: 't' })
  softDeleteWatchlistEntry('SQM')
  updateScanResult('9696.HK', { status: 'invalid', lastError: '代码不存在', lastScanAt: 'a' })
  assert.deepEqual(listScannable().map(e => e.symbol), ['ALB'])
})

test('listWatchlist 不返回已删除的行 —— 墓碑不该出现在界面上', () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'd', sourceText: 't' })
  addWatchlistEntry({ symbol: 'SQM', market: 'US', sourceDoc: 'd', sourceText: 't' })
  assert.equal(listWatchlist().length, 2)
  softDeleteWatchlistEntry('SQM')
  assert.deepEqual(listWatchlist().map(e => e.symbol), ['ALB'])
})

test('重新抽取不会把已删除的标的带回来', () => {
  // 这是「删了不会自己回来」的回归护栏。墓碑行占着主键,addWatchlistEntry 的
  // ON CONFLICT DO NOTHING 直接冲突 —— 不需要黑名单表,也不需要改抽取逻辑。
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'doc_1', sourceText: 't' })
  softDeleteWatchlistEntry('ALB')
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'doc_1', sourceText: 't' })
  assert.deepEqual(listWatchlist(), [])
  assert.deepEqual(listScannable(), [])
})

test('复活已删除的标的,并清掉上一次的失败状态', () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'd', sourceText: 't' })
  updateScanResult('ALB', { status: 'invalid', lastError: '代码不存在', lastScanAt: 'a' })
  softDeleteWatchlistEntry('ALB')
  assert.deepEqual(listWatchlist(), [])

  reviveWatchlistEntry('ALB')
  const e = listWatchlist()[0]
  assert.equal(e.symbol, 'ALB')
  assert.equal(e.enabled, 1)
  assert.equal(e.status, 'ok')        // 复活时状态归零,否则它永远进不了 listScannable
  assert.equal(e.last_error, null)
  assert.deepEqual(listScannable().map(x => x.symbol), ['ALB'])
})
