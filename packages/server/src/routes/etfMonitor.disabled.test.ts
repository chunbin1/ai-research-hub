import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

process.env.AUTH_DISABLED = 'true'
process.env.ETF_MONITOR = 'off'

const { initSiteSettingsTable } = await import('../services/siteSettingsStore.ts')
const { initEtfMonitorTables } = await import('../services/etfMonitorStore.ts')
const { etfMonitorRoutes } = await import('./etfMonitor.ts')

test('ETF_MONITOR=off 时整组路由返回 404 etf_monitor_disabled', async () => {
  const db = new Database(':memory:')
  initSiteSettingsTable(db)
  initEtfMonitorTables(db)
  const app = fastify()
  await app.register(etfMonitorRoutes, { prefix: '/api' })
  await app.ready()

  for (const [method, url, payload] of [
    ['GET', '/api/etf/board', undefined],
    ['GET', '/api/etf/timeline', undefined],
    ['GET', '/api/etf/510300/history', undefined],
    ['POST', '/api/etf/scan', undefined],
    ['POST', '/api/etf/universe', { code: '510350', tier: 'mega' }],
    ['PATCH', '/api/etf/universe/510300', { enabled: false }],
    ['DELETE', '/api/etf/universe/510300', undefined],
    ['PATCH', '/api/etf/params', { volRatioThreshold: 2 }],
  ] as const) {
    const res = await app.inject({ method, url, payload })
    assert.equal(res.statusCode, 404, `${method} ${url} 应该 404`)
    assert.equal(res.json().error, 'etf_monitor_disabled')
  }
})
