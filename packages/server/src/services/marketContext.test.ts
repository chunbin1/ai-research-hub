import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initWatchlistTable, addWatchlistEntry, updateScanResult } from './watchlistStore.ts'
import { initSignalTables, replaceStates } from './signalStore.ts'
import { initWhaleTables, replaceFiling, replaceTickers } from './whales/store.ts'
import { marketAppendixForMarkdown } from './marketContext.ts'

process.env.APP_URL = 'https://arh.example'

const db = new Database(':memory:')
initWatchlistTable(db)
initSignalTables(db)
initWhaleTables(db)

const MD = `# 锂电

## 5.5 Albemarle（NYSE: ALB）

正文里的 NYSE: SQM 不该被抽进来。
`

test('标题里的代码带上信号和名家持仓,正文里的代码不带', () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: null, sourceText: 'NYSE: ALB' })
  updateScanResult('ALB', {
    name: 'Albemarle', currency: 'USD', status: 'ok', lastError: null, lastScanAt: '2026-10-09T00:00:00.000Z',
  })
  replaceStates('ALB', '1d', [{
    symbol: 'ALB', timeframe: '1d', bar_date: '2026-10-09', trend: 1,
    stop_line: 90, close_adj: 99, close_raw: 98, atr: 3,
  }])
  replaceTickers([{ ticker: 'ALB', title: 'Albemarle Corp', cik: '0000915913' }], '2026-10-27T00:00:00.000Z')
  replaceFiling({
    slug: 'berkshire', accession: '0001193125-26-000001', form: '13F-HR',
    reportPeriod: '2026-03-31', filedAt: '2026-05-15', sourceUrl: 'https://www.sec.gov/prev',
    valueUnit: 'dollars', fetchedAt: '2026-10-27T00:00:00.000Z',
    positions: [{
      cusip: '012653101', putCall: '', shareType: 'SH', issuerName: 'ALBEMARLE CORP',
      titleOfClass: 'COM', shares: 10, valueReported: 100, valueUsd: 100,
    }],
  })
  replaceFiling({
    slug: 'berkshire', accession: '0001193125-26-000002', form: '13F-HR',
    reportPeriod: '2026-06-30', filedAt: '2026-08-14', sourceUrl: 'https://www.sec.gov/latest',
    valueUnit: 'dollars', fetchedAt: '2026-10-27T00:00:00.000Z',
    positions: [{
      cusip: '012653101', putCall: '', shareType: 'SH', issuerName: 'ALBEMARLE CORP',
      titleOfClass: 'COM', shares: 15, valueReported: 200, valueUsd: 200,
    }],
  })

  const text = marketAppendixForMarkdown(MD)
  assert.match(text, /ALB/)
  assert.doesNotMatch(text, /SQM/)
  assert.match(text, /日线：多头/)
  assert.match(text, /收盘（未复权）98/)
  assert.match(text, /距止损 10\.0%/)
  assert.match(text, /巴菲特/)
  assert.match(text, /加仓/)
  assert.match(text, /https:\/\/arh\.example\/whales\/berkshire/)
  assert.match(text, /https:\/\/arh\.example\/signals/)
})

test('众议院披露不写 0 股，增减按金额而不是股数', () => {
  replaceTickers([{ ticker: 'AAPL', title: 'Apple Inc', cik: '0000320193' }], '2026-10-27T00:00:00.000Z')
  const line = (value: number, label: string) => ({
    cusip: 'AAPL', putCall: '' as const, shareType: 'SH', issuerName: 'Apple Inc. (AAPL)',
    titleOfClass: 'COM', shares: 0, valueReported: value, valueUsd: value, valueLabel: label,
  })
  replaceFiling({
    slug: 'pelosi', accession: 'house-1', form: 'HOUSE-FD',
    reportPeriod: '2024-12-31', filedAt: '2025-05-15', sourceUrl: 'https://disclosures-clerk.house.gov/a',
    valueUnit: 'dollars', fetchedAt: '2026-10-27T00:00:00.000Z',
    positions: [line(1_000_000, '500,001–1,000,000')],
  })
  replaceFiling({
    slug: 'pelosi', accession: 'house-2', form: 'HOUSE-FD',
    reportPeriod: '2025-12-31', filedAt: '2026-05-15', sourceUrl: 'https://disclosures-clerk.house.gov/b',
    valueUnit: 'dollars', fetchedAt: '2026-10-27T00:00:00.000Z',
    positions: [line(3_000_000, '1,000,001–5,000,000')],
  })
  const text = marketAppendixForMarkdown('# 苹果\n\n## Apple（NYSE: AAPL）\n\n正文。\n')
  assert.match(text, /佩洛西/)
  assert.match(text, /金额区间 1,000,001–5,000,000/)
  assert.match(text, /较上期金额增加/)
  assert.doesNotMatch(text, /持有 0/)
  assert.doesNotMatch(text, /股数/)
})

test('标题里没有代码时说明没有可对照的数据', () => {
  const text = marketAppendixForMarkdown('# 锂电产业链\n\n## 供给\n\n盐湖。\n')
  assert.match(text, /没有美股或港股代码/)
  assert.doesNotMatch(text, /ALB/)
})

test('功能关闭时写明未开启,不附数字', () => {
  const savedSignals = process.env.SIGNALS
  const savedWhales = process.env.WHALES
  process.env.SIGNALS = 'off'
  process.env.WHALES = 'off'
  try {
    const text = marketAppendixForMarkdown(MD)
    assert.match(text, /信号未开启/)
    assert.match(text, /名家持仓未开启/)
    assert.doesNotMatch(text, /止损线/)
    assert.doesNotMatch(text, /巴菲特/)
  } finally {
    if (savedSignals === undefined) delete process.env.SIGNALS
    else process.env.SIGNALS = savedSignals
    if (savedWhales === undefined) delete process.env.WHALES
    else process.env.WHALES = savedWhales
  }
})
