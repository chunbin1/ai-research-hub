// packages/server/src/routes/siteSettings.test.ts
//
// AUTH_DISABLED 必须在 auth.ts 被求值之前设好(它在模块顶层读一次 env 存成
// const),而静态 import 会先于本文件其余代码执行 —— 所以这里用动态 import。
// AUTH_DISABLED=true 时合成用户的 is_admin=1,requireAdmin 直接放行,
// 本文件覆盖的是管理员视角的行为;401 那条在 siteSettings.auth.test.ts。
//
// 探测一律走注入的假实现,全程不碰网络。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

process.env.AUTH_DISABLED = 'true'
process.env.ZHIPU_API_KEY = 'server-key'
process.env.ZHIPU_MODEL = 'glm-4.7'
delete process.env.ANTHROPIC_API_KEY
delete process.env.LLM_PROVIDER

const { initSiteSettingsTable, getSetting, setSetting, DEFAULT_MODEL_KEY } =
  await import('../services/siteSettingsStore.ts')
const { siteSettingsRoutes } = await import('./siteSettings.ts')

type ProbeResult = { ok: true } | { ok: false; reason: string }

async function freshApp(probeResult: ProbeResult = { ok: true }) {
  initSiteSettingsTable(new Database(':memory:'))
  const app = fastify()
  await app.register(siteSettingsRoutes, {
    prefix: '/api',
    probe: async () => probeResult,
  })
  await app.ready()
  return app
}

test('GET:没设过 override 时 source=env,model 取自 .env', async () => {
  const app = await freshApp()
  const res = await app.inject({ method: 'GET', url: '/api/site-model' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.source, 'env')
  assert.equal(body.model, 'glm-4.7')
  assert.equal(body.envModel, 'glm-4.7')
  assert.equal(body.providerId, 'zhipu')
  assert.equal(body.configError, null)
  assert.ok(body.suggestedModels.includes('glm-4.7-flash'))
})

test('GET:设过 override 后 source=db,model 取库里的值,envModel 仍是 .env 原值', async () => {
  const app = await freshApp()
  setSetting(DEFAULT_MODEL_KEY, 'glm-4.7-flash')
  const body = (await app.inject({ method: 'GET', url: '/api/site-model' })).json()
  assert.equal(body.source, 'db')
  assert.equal(body.model, 'glm-4.7-flash')
  assert.equal(body.envModel, 'glm-4.7')
})

test('PUT:探测通过时写库', async () => {
  const app = await freshApp({ ok: true })
  const res = await app.inject({ method: 'PUT', url: '/api/site-model', payload: { model: 'glm-4.7-flash' } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { ok: true })
  assert.equal(getSetting(DEFAULT_MODEL_KEY), 'glm-4.7-flash')
})

test('PUT:探测失败时返回 400 且不写库', async () => {
  const app = await freshApp({ ok: false, reason: '模型名不存在' })
  const res = await app.inject({ method: 'PUT', url: '/api/site-model', payload: { model: 'glm-9-nope' } })
  assert.equal(res.statusCode, 400)
  assert.match(res.json().message, /模型名不存在/)
  assert.equal(getSetting(DEFAULT_MODEL_KEY), null)
})

test('PUT:探测失败时不覆盖已有的 override', async () => {
  const app = await freshApp({ ok: false, reason: '模型名不存在' })
  setSetting(DEFAULT_MODEL_KEY, 'glm-4.7-flash')
  await app.inject({ method: 'PUT', url: '/api/site-model', payload: { model: 'glm-9-nope' } })
  assert.equal(getSetting(DEFAULT_MODEL_KEY), 'glm-4.7-flash')
})

test('PUT:model 为空串或纯空白时 400,且不触发探测', async () => {
  let probed = false
  initSiteSettingsTable(new Database(':memory:'))
  const app = fastify()
  await app.register(siteSettingsRoutes, {
    prefix: '/api',
    probe: async () => { probed = true; return { ok: true } },
  })
  await app.ready()

  for (const model of ['', '   ']) {
    const res = await app.inject({ method: 'PUT', url: '/api/site-model', payload: { model } })
    assert.equal(res.statusCode, 400)
  }
  assert.equal(probed, false)
  assert.equal(getSetting(DEFAULT_MODEL_KEY), null)
})

test('PUT:model 不是字符串时 400', async () => {
  const app = await freshApp()
  const res = await app.inject({ method: 'PUT', url: '/api/site-model', payload: { model: 123 } })
  assert.equal(res.statusCode, 400)
  assert.match(res.json().message, /字符串/)
})

test('PUT:保存的是 trim 后的模型名', async () => {
  const app = await freshApp({ ok: true })
  await app.inject({ method: 'PUT', url: '/api/site-model', payload: { model: '  glm-4.7-flash  ' } })
  assert.equal(getSetting(DEFAULT_MODEL_KEY), 'glm-4.7-flash')
})

test('DELETE:删掉 override 后 GET 回到 env', async () => {
  const app = await freshApp()
  setSetting(DEFAULT_MODEL_KEY, 'glm-4.7-flash')
  const res = await app.inject({ method: 'DELETE', url: '/api/site-model' })
  assert.equal(res.statusCode, 200)
  const body = (await app.inject({ method: 'GET', url: '/api/site-model' })).json()
  assert.equal(body.source, 'env')
  assert.equal(body.model, 'glm-4.7')
})
