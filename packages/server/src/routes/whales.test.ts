import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

const { initWhaleTables, replaceFiling } = await import('../services/whales/store.ts')
const { whaleRoutes } = await import('./whales.ts')

async function appWithDb() {
  initWhaleTables(new Database(':memory:'))
  const app = fastify()
  await app.register(whaleRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

test('没有申报时六家都在，状态是 empty', async () => {
  const app = await appWithDb()
  const res = await app.inject({ method: 'GET', url: '/api/whales' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.institutions.length, 6)
  assert.ok(body.valueNote.includes('美元'))
  assert.deepEqual(body.institutions.map((row: { slug: string }) => row.slug), [
    'berkshire', 'himalaya', 'hhlr', 'pershing', 'scion', 'ark',
  ])
  assert.equal(body.institutions[2].cik, '0001762304')
  assert.ok(body.institutions.every((row: { dataStatus: string; latest: unknown }) => row.dataStatus === 'empty' && row.latest === null))
  const missing = await app.inject({ method: 'GET', url: '/api/whales/nope' })
  assert.equal(missing.statusCode, 404)
  assert.deepEqual(missing.json(), { error: 'not_found' })
})

test('详情含相对上期的增减，未知机构 404', async () => {
  const app = await appWithDb()
  const line = (cusip: string, name: string, shares: number, value: number) => ({
    cusip, putCall: '' as const, shareType: 'SH', issuerName: name, titleOfClass: 'COM',
    shares, valueReported: value, valueUsd: value,
  })
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
    positions: [line('037833100', 'APPLE INC', 15, 200), line('594918104', 'MICROSOFT CORP', 2, 20)],
  })

  const res = await app.inject({ method: 'GET', url: '/api/whales/berkshire' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.period.reportPeriod, '2026-06-30')
  assert.equal(body.previousPeriod.reportPeriod, '2026-03-31')
  const apple = body.positions.find((row: { cusip: string }) => row.cusip === '037833100')
  const created = body.positions.find((row: { cusip: string }) => row.cusip === '594918104')
  assert.equal(apple.change, 'increased')
  assert.equal(apple.shareDelta, 5)
  assert.equal(apple.shareType, 'SH')
  assert.equal(created.change, 'new')
  assert.equal(body.closed[0].change, 'closed')
  assert.equal(body.closed[0].cusip, '191216100')

  const list = (await app.inject({ method: 'GET', url: '/api/whales' })).json()
  const berkshire = list.institutions.find((row: { slug: string }) => row.slug === 'berkshire')
  const scion = list.institutions.find((row: { slug: string }) => row.slug === 'scion')
  assert.equal(berkshire.dataStatus, 'ready')
  assert.equal(berkshire.latest.positionCount, 2)
  assert.equal(berkshire.latest.totalValueUsd, 220)
  assert.equal(scion.dataStatus, 'empty')
})

test('WHALES=off 时列表也 404', async () => {
  const app = await appWithDb()
  const saved = process.env.WHALES
  process.env.WHALES = 'off'
  try {
    const res = await app.inject({ method: 'GET', url: '/api/whales' })
    assert.equal(res.statusCode, 404)
    assert.deepEqual(res.json(), { error: 'whales_disabled' })
    const detail = await app.inject({ method: 'GET', url: '/api/whales/berkshire' })
    assert.equal(detail.statusCode, 404)
    assert.deepEqual(detail.json(), { error: 'whales_disabled' })
  } finally {
    if (saved === undefined) delete process.env.WHALES
    else process.env.WHALES = saved
  }
})
