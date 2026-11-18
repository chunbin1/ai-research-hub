import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchTicker, parseCompanyTickers } from './tickers.ts'

const ROWS = parseCompanyTickers(JSON.stringify({
  '0': { cik_str: 320193, ticker: 'aapl', title: 'Apple Inc.' },
  '1': { cik_str: 1067983, ticker: 'BRK-A', title: 'Berkshire Hathaway Inc' },
  '2': { cik_str: 1067983, ticker: 'BRK-B', title: 'Berkshire Hathaway Inc.' },
  '3': { ticker: '', title: 'Skip Me' },
}))

test('公司名唯一时配上 ticker，大小写和 INC 后缀不影响', () => {
  assert.equal(matchTicker(ROWS, 'APPLE INC'), 'AAPL')
  assert.equal(matchTicker(ROWS, 'Apple Inc.'), 'AAPL')
})

test('同一公司名对应多个 ticker 时不猜测', () => {
  assert.equal(matchTicker(ROWS, 'BERKSHIRE HATHAWAY INC'), null)
})

test('对不上就留空', () => {
  assert.equal(matchTicker(ROWS, 'SCION ASSET MANAGEMENT LLC'), null)
  assert.equal(ROWS.find(row => row.ticker === 'AAPL')?.cik, '0000320193')
})
