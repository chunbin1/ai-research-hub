// packages/server/src/routes/siteSettings.auth.test.ts
//
// 单独一个文件,因为 AUTH_DISABLED 在 auth.ts 模块顶层只求值一次 ——
// 同一个进程里没法既是「跳过登录」又是「未登录」。node:test 每个文件跑在
// 独立子进程,这里不设 AUTH_DISABLED,三个路由都应该 401。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

delete process.env.AUTH_DISABLED

const { initSiteSettingsTable } = await import('../services/siteSettingsStore.ts')
const { siteSettingsRoutes } = await import('./siteSettings.ts')

async function freshApp() {
  initSiteSettingsTable(new Database(':memory:'))
  const app = fastify()
  await app.register(siteSettingsRoutes, { prefix: '/api', probe: async () => ({ ok: true }) })
  await app.ready()
  return app
}

test('未登录时三个路由都 401', async () => {
  const app = await freshApp()
  for (const [method, payload] of [
    ['GET', undefined],
    ['PUT', { model: 'glm-4.7-flash' }],
    ['DELETE', undefined],
  ] as const) {
    const res = await app.inject({ method, url: '/api/site-model', payload })
    assert.equal(res.statusCode, 401, `${method} 应该 401`)
  }
})
