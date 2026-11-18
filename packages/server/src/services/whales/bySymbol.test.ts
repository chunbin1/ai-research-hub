import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initWhaleTables, replaceFiling, replaceTickers } from './store.ts'
import { holdingsForTickers } from './bySymbol.ts'

const line = (cusip: string, name: string, shares: number, value: number) => ({
  cusip, putCall: '' as const, shareType: 'SH', issuerName: name, titleOfClass: 'COM',
  shares, valueReported: value, valueUsd: value,
})

test('按代码匹配最新一期的持仓和本期清仓', () => {
  initWhaleTables(new Database(':memory:'))
  replaceTickers([
    { ticker: 'AAPL', title: 'Apple Inc', cik: '0000320193' },
    { ticker: 'KO', title: 'Coca Cola Co', cik: '0000021344' },
  ], '2026-10-27T00:00:00.000Z')
  replaceFiling({
    slug: 'berkshire', accession: '0001193125-26-000001', form: '13F-HR',
    reportPeriod: '2026-03-31', filedAt: '2026-05-15', sourceUrl: 'https://www.sec.gov/prev',
    valueUnit: 'dollars', fetchedAt: '2026-10-27T00:00:00.000Z',
    positions: [line('037833100', 'APPLE INC', 10, 100), line('191216100', 'COCA COLA CO', 4, 40)],
  })
  replaceFiling({
    slug: 'berkshire', accession: '0001193125-26-000002', form: '13F-HR',
    reportPeriod: '2026-06-30', filedAt: '2026-08-14', sourceUrl: 'https://www.sec.gov/latest',
    valueUnit: 'dollars', fetchedAt: '2026-10-27T00:00:00.000Z',
    positions: [line('037833100', 'APPLE INC', 15, 200)],
  })

  const apple = holdingsForTickers(['aapl'])
  assert.equal(apple.length, 1)
  assert.equal(apple[0]?.manager, '巴菲特')
  assert.equal(apple[0]?.change, 'increased')
  assert.equal(apple[0]?.shareDelta, 5)
  assert.equal(apple[0]?.weight, 1)
  assert.equal(apple[0]?.closed, false)

  const coke = holdingsForTickers(['KO'])
  assert.equal(coke.length, 1)
  assert.equal(coke[0]?.closed, true)
  assert.equal(coke[0]?.prevShares, 4)
  assert.equal(coke[0]?.weight, null)

  assert.deepEqual(holdingsForTickers(['TSLA']), [])
  assert.deepEqual(holdingsForTickers([]), [])
})
