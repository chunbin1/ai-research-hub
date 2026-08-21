// 单独一个文件:AUTH_DISABLED 在 auth.ts 模块顶层只求值一次,同一进程里
// 没法既「跳过登录」又「未登录」。node:test 每个文件跑独立子进程。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

delete process.env.AUTH_DISABLED
delete process.env.SIGNALS

const { initWatchlistTable } = await import('../services/watchlistStore.ts')
const { initSignalTables } = await import('../services/signalStore.ts')
const { initSiteSettingsTable } = await import('../services/siteSettingsStore.ts')
const { signalRoutes } = await import('./signals.ts')

async function freshApp() {
  const db = new Database(':memory:')
  initWatchlistTable(db); initSignalTables(db); initSiteSettingsTable(db)
  const app = fastify()
  await app.register(signalRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

test('读接口公开,写接口未登录一律 401', async () => {
  const app = await freshApp()
  assert.equal((await app.inject({ method: 'GET', url: '/api/signals' })).statusCode, 200)

  for (const [method, url, payload] of [
    ['POST', '/api/signals/scan', undefined],
    ['POST', '/api/signals/extract', undefined],
    ['PATCH', '/api/signals/watchlist/ALB', { enabled: false }],
  ] as const) {
    const res = await app.inject({ method, url, payload })
    assert.equal(res.statusCode, 401, `${method} ${url} 应该 401`)
  }
})
