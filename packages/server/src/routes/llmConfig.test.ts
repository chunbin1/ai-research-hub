// packages/server/src/routes/llmConfig.test.ts
//
// POST /llm-config/test 的「没给 apiKey,用库里存的 key」分支(else 分支)。
// 重点覆盖 0caef41 引入的回归:providerId=custom + 请求体里任意 baseURL +
// 不带 apiKey,不应该再能把库里存的 key(哪怕是别的 provider 的)发到
// 请求体里新填的端点。
//
// 本文件全程不依赖真实网络访问:凡是会走到 probeLLMConfig(真的发起探测
// 请求)的场景,只断言「新加的门槛没有把它拦在半路」,不对探测本身的成败
// 或状态码做断言 —— 那属于网络环境,不属于这份代码的行为。
//
// AUTH_DISABLED 必须在 auth.ts 被求值之前设好(它在模块顶层读一次 env 存成
// const),而静态 import 会先于本文件其余代码执行 —— 所以这里用动态 import,
// 确保 env 先设好、路由模块后加载。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

process.env.AUTH_DISABLED = 'true'
process.env.LLM_KEY_SECRET = 'a'.repeat(64)

const { initLLMConfigTable, upsertConfig } = await import('../services/llmConfigStore.ts')
const { llmConfigRoutes } = await import('./llmConfig.ts')

async function freshApp() {
  const db = new Database(':memory:')
  initLLMConfigTable(db)
  const app = fastify()
  await app.register(llmConfigRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

// AUTH_DISABLED=true 时 currentUser() 直接返回这个合成用户,user_id 恒为 'dev'。
const USER_ID = 'dev'

test('providerId=custom + 攻击者 baseURL + 不带 apiKey → 400,库里存的 key 从未被用到', async () => {
  const app = await freshApp()
  const secretKey = 'sk-zhipu-super-secret-000111'
  upsertConfig(USER_ID, { providerId: 'zhipu', model: 'glm-4-flash', apiKey: secretKey })

  const res = await app.inject({
    method: 'POST',
    url: '/api/llm-config/test',
    payload: { providerId: 'custom', baseURL: 'https://attacker.example.com/v1' },
  })

  // 库里存的是 zhipu,不是 custom —— 请求体想把它「借」给一个新填的 custom
  // 端点,必须被拒;而且是在建 config、发探测请求之前就拒,所以这个断言
  // 不依赖任何真实网络访问。
  assert.equal(res.statusCode, 400)
  const body = res.json()
  assert.equal(body.ok, false)
  assert.match(body.reason, /自定义 provider/)
  // 明文 key 不得以任何形式出现在响应里。
  assert.ok(!res.body.includes(secretKey))
})

test('库里存的本来就是 custom provider + 不带 apiKey → 没有被新加的门槛拦下', async () => {
  const app = await freshApp()
  upsertConfig(USER_ID, {
    providerId: 'custom', baseURL: 'https://example.com/v1',
    model: 'my-model', apiKey: 'sk-custom-000111',
  })

  const res = await app.inject({ method: 'POST', url: '/api/llm-config/test', payload: {} })

  // 不对状态码/网络结果做断言(探测会真的请求 example.com,离线环境下
  // 会因 DNS 解析失败而在 assertPublicBaseURL 处提前 400,这不代表我们的
  // 门槛拦下了它)。这个测试要证明的只是「新加的门槛没有拦下 custom→custom
  // 这个合法场景」,所以只断言响应里不是门槛的拒绝理由。
  const body = res.json()
  assert.notEqual(body.reason, '切换到自定义 provider 前需要先填写并保存该端点对应的 API key')
})

test('没有任何存量配置 → 400 尚未配置自己的模型', async () => {
  const app = await freshApp()
  const res = await app.inject({ method: 'POST', url: '/api/llm-config/test', payload: {} })
  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.json(), { ok: false, reason: '尚未配置自己的模型' })
})

test('custom→custom 覆盖 baseURL 时,assertPublicBaseURL 仍然拦下内网地址', async () => {
  const app = await freshApp()
  upsertConfig(USER_ID, {
    providerId: 'custom', baseURL: 'https://example.com/v1',
    model: 'my-model', apiKey: 'sk-custom-000333',
  })

  const res = await app.inject({
    method: 'POST',
    url: '/api/llm-config/test',
    payload: { baseURL: 'https://127.0.0.1/v1' },
  })

  // 127.0.0.1 是字面量 IP,判定是否内网不需要真实网络访问,断言不依赖外网。
  assert.equal(res.statusCode, 400)
  const body = res.json()
  assert.equal(body.ok, false)
  assert.match(body.reason, /内网/)
})
