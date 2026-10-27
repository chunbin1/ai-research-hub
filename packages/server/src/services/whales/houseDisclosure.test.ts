import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { parseHouseAnnualIndex, parseHouseHoldings } from './houseDisclosure.ts'
import { initWhaleTables } from './store.ts'
import { getWhaleDetail } from './view.ts'
import { syncWhales } from './sync.ts'

const FIXTURE = readFileSync(new URL('./fixtures/pelosi-2025.txt', import.meta.url), 'utf8')

const INDEX = [
  'Prefix\tLast\tFirst\tSuffix\tFilingType\tStateDst\tYear\tFilingDate\tDocID',
  'Hon.\tPelosi\tNancy\t\tP\tCA11\t2025\t1/17/2025\t20026590',
  'Hon.\tPelosi\tNancy\t\tO\tCA11\t2025\t5/15/2026\t10075701',
].join('\n')

test('年度披露只留下有市值的上市证券，期权单独成行', () => {
  const rows = parseHouseHoldings(FIXTURE)
  const apple = rows.find(row => row.cusip === 'AAPL' && row.putCall === '')
  const calls = rows.find(row => row.cusip === 'GOOGL' && row.putCall === 'Call')
  assert.equal(apple?.issuerName, 'Apple Inc. (AAPL)')
  assert.equal(rows.find(row => row.cusip === 'NVDA' && row.putCall === '')?.issuerName, 'NVIDIA Corporation - Common Stock (NVDA)')
  assert.equal(apple?.valueLabel, '5,000,001–25,000,000')
  assert.equal(apple?.shares, 0)
  assert.equal(calls?.valueLabel, '1,000,001–5,000,000')
  assert.ok((calls?.shares ?? 0) > 0)
  assert.equal(rows.some(row => row.cusip === 'PYPL'), false)
  assert.equal(rows.some(row => row.cusip === 'DIS'), false)
  assert.equal(rows.some(row => row.issuerName.includes('Zinfandel')), false)
  assert.ok(rows.length >= 20)
})

test('索引只认年度报告，定期交易报告不算持仓快照', () => {
  const rows = parseHouseAnnualIndex(INDEX, { last: 'Pelosi', first: 'Nancy' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.docId, '10075701')
  assert.equal(rows[0]?.filedAt, '2026-05-15')
  assert.equal(rows[0]?.reportPeriod, '2025-12-31')
  assert.equal(rows[0]?.pdfUrl, 'https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2025/10075701.pdf')
})

test('同步把佩洛西写成区间持仓，相同文档不重复下载', async () => {
  initWhaleTables(new Database(':memory:'))
  const downloads: string[] = []
  const transport = {
    async getText(url: string) {
      if (url.endsWith('2025FD.txt')) return INDEX
      if (url.endsWith('FD.txt')) throw new Error('下载失败 404 ' + url)
      if (url.includes('company_tickers.json')) return '{}'
      if (url.includes('/submissions/')) return JSON.stringify({ filings: { recent: {} } })
      throw new Error(`意外的 URL ${url}`)
    },
    async getBytes(url: string) {
      downloads.push(url)
      return new Uint8Array([1])
    },
  }
  const now = () => new Date('2026-10-27T00:00:00.000Z')
  const first = await syncWhales({
    transport,
    userAgent: 'test-agent',
    now,
    extractPdfText: async () => FIXTURE,
  })
  assert.equal(first.failed, 0)
  assert.deepEqual(downloads, [
    'https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2025/10075701.pdf',
  ])
  const detail = getWhaleDetail('pelosi')
  assert.equal(detail?.institution.source, 'house-fd')
  assert.equal(detail?.period?.form, '年度披露')
  assert.equal(detail?.period?.reportPeriod, '2025-12-31')
  assert.ok(detail?.valueNote.includes('申报区间'))
  assert.equal(detail?.positions.find(row => row.cusip === 'AAPL' && row.putCall === '')?.valueLabel, '5,000,001–25,000,000')
  assert.equal(detail?.previousPeriod, null)

  downloads.length = 0
  const second = await syncWhales({
    transport,
    userAgent: 'test-agent',
    now: () => new Date('2026-10-27T02:00:00.000Z'),
    extractPdfText: async () => FIXTURE,
  })
  assert.equal(second.failed, 0)
  assert.deepEqual(downloads, [])
})
