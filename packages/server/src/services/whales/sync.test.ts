// 同步的夹具路径：不访问 SEC。假 transport 按 URL 回 submissions、索引和信息表。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { getMeta, getSync, initWhaleTables } from './store.ts'
import { getWhaleDetail, listWhaleSummaries } from './view.ts'
import { resolveSecUserAgent } from './enabled.ts'
import { syncWhales } from './sync.ts'

function xml(rows: string): string {
  return `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">${rows}</informationTable>`
}

function holding(cusip: string, name: string, shares: number, value: number): string {
  return `<infoTable>
    <nameOfIssuer>${name}</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>${cusip}</cusip>
    <value>${value}</value>
    <shrsOrPrnAmt><sshPrnamt>${shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
  </infoTable>`
}

const CURRENT = xml(
  holding('037833100', 'APPLE INC', 200, 2000) + holding('594918104', 'MICROSOFT CORP', 50, 500),
)
const PREVIOUS = xml(
  holding('037833100', 'APPLE INC', 100, 900) + holding('191216100', 'COCA COLA CO', 10, 100),
)

function indexHtml(href: string): string {
  return `<table><tr><td>INFORMATION TABLE</td><a href="${href}">info.xml</a></tr></table>`
}

function submissions(forms: string[]): string {
  return JSON.stringify({
    filings: {
      recent: {
        form: forms,
        accessionNumber: forms.map((_, i) => `0001193125-26-00000${i + 1}`),
        filingDate: forms.map(() => '2026-08-14'),
        reportDate: forms.map((_, i) => (i === 0 ? '2026-06-30' : '2026-03-31')),
      },
    },
  })
}

test('没有 User-Agent 时不请求 SEC', async () => {
  initWhaleTables(new Database(':memory:'))
  let called = false
  const result = await syncWhales({
    userAgent: null,
    transport: { async getText() { called = true; return '' } },
  })
  assert.equal(result.skipped, true)
  assert.equal(called, false)
  const saved = process.env.SEC_USER_AGENT
  const email = process.env.WHALES_CONTACT_EMAIL
  delete process.env.SEC_USER_AGENT
  delete process.env.WHALES_CONTACT_EMAIL
  try {
    assert.equal(resolveSecUserAgent(), null)
    process.env.WHALES_CONTACT_EMAIL = 'ops@example.com'
    assert.equal(resolveSecUserAgent(), 'ai-research-hub whales-13f (ops@example.com)')
    process.env.SEC_USER_AGENT = 'Custom Agent ops@example.com'
    assert.equal(resolveSecUserAgent(), 'Custom Agent ops@example.com')
  } finally {
    if (saved === undefined) delete process.env.SEC_USER_AGENT
    else process.env.SEC_USER_AGENT = saved
    if (email === undefined) delete process.env.WHALES_CONTACT_EMAIL
    else process.env.WHALES_CONTACT_EMAIL = email
  }
})

test('夹具同步出增减，第二轮相同 accession 不再下 XML', async () => {
  initWhaleTables(new Database(':memory:'))
  const calls: string[] = []
  const transport = {
    async getText(url: string) {
      calls.push(url)
      if (url.includes('company_tickers.json')) {
        return JSON.stringify({
          '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
        })
      }
      if (url.includes('CIK0001067983')) {
        return JSON.stringify({
          filings: {
            recent: {
              form: ['13F-HR', '13F-HR', '10-K'],
              accessionNumber: ['0001193125-26-000002', '0001193125-26-000001', '0000000000-26-000099'],
              filingDate: ['2026-08-14', '2026-05-15', '2026-02-01'],
              reportDate: ['2026-06-30', '2026-03-31', '2025-12-31'],
            },
          },
        })
      }
      if (url.includes('/submissions/')) return submissions(['10-K'])
      if (url.endsWith('0001193125-26-000002-index.htm')) {
        return indexHtml('/Archives/edgar/data/1067983/000119312526000002/info.xml')
      }
      if (url.endsWith('0001193125-26-000001-index.htm')) {
        return indexHtml('info.xml')
      }
      if (url.endsWith('/000119312526000002/info.xml')) return CURRENT
      if (url.endsWith('/000119312526000001/info.xml')) return PREVIOUS
      throw new Error(`意外的 URL ${url}`)
    },
  }

  const first = await syncWhales({ transport, userAgent: 'test-agent', now: () => new Date('2026-10-27T00:00:00.000Z') })
  assert.equal(first.failed, 0)
  assert.equal(first.ok, 1)
  assert.equal(first.empty, 5)
  assert.ok(calls.includes(
    'https://www.sec.gov/Archives/edgar/data/1067983/000119312526000001/info.xml',
  ))

  const detail = getWhaleDetail('berkshire')
  assert.ok(detail)
  assert.equal(detail.period?.valueUnit, 'dollars')
  assert.equal(detail.previousPeriod?.reportPeriod, '2026-03-31')
  const apple = detail.positions.find(row => row.cusip === '037833100')
  const microsoft = detail.positions.find(row => row.cusip === '594918104')
  assert.equal(apple?.ticker, 'AAPL')
  assert.equal(apple?.change, 'increased')
  assert.equal(apple?.shareDelta, 100)
  assert.equal(apple?.valueUsd, 2000)
  assert.equal(microsoft?.ticker, null)
  assert.equal(microsoft?.issuerName, 'MICROSOFT CORP')
  assert.equal(microsoft?.change, 'new')
  assert.equal(detail.closed.length, 1)
  assert.equal(detail.closed[0]?.change, 'closed')
  assert.equal(detail.closed[0]?.cusip, '191216100')

  const summary = listWhaleSummaries().institutions.find(row => row.slug === 'himalaya')
  assert.equal(summary?.dataStatus, 'empty')
  assert.equal(summary?.latest, null)

  const before = calls.length
  calls.length = 0
  const second = await syncWhales({ transport, userAgent: 'test-agent', now: () => new Date('2026-10-27T01:00:00.000Z') })
  assert.equal(second.failed, 0)
  assert.equal(calls.some(url => url.includes('info.xml') || url.includes('company_tickers')), false)
  assert.ok(calls.length < before)
})

test('信息表指向非 SEC 主机时记入该机构错误，且不去请求', async () => {
  initWhaleTables(new Database(':memory:'))
  const calls: string[] = []
  const transport = {
    async getText(url: string) {
      calls.push(url)
      if (url.includes('company_tickers.json')) return '{}'
      if (url.includes('CIK0001067983')) {
        return JSON.stringify({
          filings: {
            recent: {
              form: ['13F-HR'],
              accessionNumber: ['0001193125-26-000002'],
              filingDate: ['2026-08-14'],
              reportDate: ['2026-06-30'],
            },
          },
        })
      }
      if (url.includes('/submissions/')) {
        return JSON.stringify({ filings: { recent: {} } })
      }
      if (url.endsWith('-index.htm')) return indexHtml('https://evil.example/info.xml')
      throw new Error(`意外的 URL ${url}`)
    },
  }
  const result = await syncWhales({
    transport,
    userAgent: 'test-agent',
    now: () => new Date('2026-10-27T00:00:00.000Z'),
  })
  assert.equal(result.failed, 1)
  assert.equal(result.ok, 0)
  assert.equal(result.empty, 5)
  assert.equal(calls.some(url => url.includes('evil.example')), false)
  assert.match(getSync('berkshire').lastError ?? '', /拒绝非 SEC/)
  assert.equal(getSync('himalaya').lastError, null)
  assert.equal(getMeta().lastSyncAt, '2026-10-27T00:00:00.000Z')
})
