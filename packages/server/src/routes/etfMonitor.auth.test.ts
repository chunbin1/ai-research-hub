import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

delete process.env.AUTH_DISABLED
delete process.env.ETF_MONITOR

const { initSiteSettingsTable } = await import('../services/siteSettingsStore.ts')
const { initEtfMonitorTables } = await import('../services/etfMonitorStore.ts')
const { etfMonitorRoutes } = await import('./etfMonitor.ts')

test('ETF 监控读接口公开，写接口未登录一律 401', async () => {
  const db = new Database(':memory:')
  initSiteSettingsTable(db)
  initEtfMonitorTables(db)
  const app = fastify()
  await app.register(etfMonitorRoutes, { prefix: '/api' })
  await app.ready()

  assert.equal((await app.inject({ method: 'GET', url: '/api/etf/board' })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/etf/timeline' })).statusCode, 200)

  for (const [method, url, payload] of [
    ['POST', '/api/etf/scan', undefined],
    ['POST', '/api/etf/universe', { code: '510350', tier: 'mega' }],
    ['PATCH', '/api/etf/universe/510300', { enabled: false }],
    ['DELETE', '/api/etf/universe/510300', undefined],
    ['PATCH', '/api/etf/params', { volRatioThreshold: 2 }],
  ] as const) {
    const res = await app.inject({ method, url, payload })
    assert.equal(res.statusCode, 401, `${method} ${url} 应该 401`)
  }
})
