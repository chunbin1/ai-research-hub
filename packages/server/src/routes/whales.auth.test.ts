// 单独一个文件:AUTH_DISABLED 在 auth.ts 模块顶层只求值一次,同一进程里
// 没法既「跳过登录」又「未登录」。node:test 每个文件跑独立子进程。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

delete process.env.AUTH_DISABLED

const { initWhaleTables } = await import('../services/whales/store.ts')
const { whaleRoutes } = await import('./whales.ts')

test('大佬持仓读公开，增删未登录一律 401', async () => {
  initWhaleTables(new Database(':memory:'))
  const app = fastify()
  await app.register(whaleRoutes, {
    prefix: '/api',
    syncOne: async () => 'empty',
  })
  await app.ready()

  assert.equal((await app.inject({ method: 'GET', url: '/api/whales' })).statusCode, 200)
  const created = await app.inject({
    method: 'POST',
    url: '/api/whales',
    payload: { cik: '0001234567', manager: '甲', nameZh: '甲公司', nameEn: 'Jia' },
  })
  assert.equal(created.statusCode, 401)
  assert.equal(created.json().error, 'unauthorized')
  const removed = await app.inject({ method: 'DELETE', url: '/api/whales/berkshire' })
  assert.equal(removed.statusCode, 401)
  const still = (await app.inject({ method: 'GET', url: '/api/whales' })).json()
  assert.equal(still.institutions.length, 6)
})
