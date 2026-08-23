// 单独一个文件:SIGNALS=off 要在路由注册前就生效,而 node:test 每个文件跑独立
// 子进程。这里刻意同时设 AUTH_DISABLED=true —— 这样管理员路由不会因为鉴权而
// 401,404 只可能来自 SIGNALS 开关本身。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

process.env.AUTH_DISABLED = 'true'
process.env.SIGNALS = 'off'

const { initWatchlistTable } = await import('../services/watchlistStore.ts')
const { initSignalTables } = await import('../services/signalStore.ts')
const { initSiteSettingsTable } = await import('../services/siteSettingsStore.ts')
const { initDocumentTable } = await import('../services/documentStore.ts')
const { signalRoutes } = await import('./signals.ts')

async function freshApp() {
  const db = new Database(':memory:')
  initWatchlistTable(db); initSignalTables(db); initSiteSettingsTable(db); initDocumentTable(db)
  const app = fastify()
  await app.register(signalRoutes, {
    prefix: '/api',
    scan: async () => ({ total: 0, ok: 0, failed: 0, insufficient: 0 }),
  })
  await app.ready()
  return app
}

test('SIGNALS=off 时整组路由返回 404,读接口也不例外', async () => {
  const app = await freshApp()
  for (const [method, url, payload] of [
    ['GET', '/api/signals', undefined],
    ['GET', '/api/signals/ALB/log', undefined],
    ['GET', '/api/signals/events', undefined],
    ['POST', '/api/signals/scan', undefined],
    ['POST', '/api/signals/extract', undefined],
    ['POST', '/api/signals/watchlist/probe', { code: 'RKLB' }],
    ['POST', '/api/signals/watchlist', { symbol: 'RKLB', market: 'US' }],
    ['DELETE', '/api/signals/watchlist/ALB', undefined],
  ] as const) {
    const res = await app.inject({ method, url, payload })
    assert.equal(res.statusCode, 404, `${method} ${url} 应该 404`)
    assert.equal(res.json().error, 'signals_disabled')
  }
})
