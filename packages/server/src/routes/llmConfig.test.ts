// packages/server/src/routes/llmConfig.test.ts
//
// POST /llm-config/test 的「没给 apiKey,用库里存的 key」分支(else 分支),
// 以及 PUT /llm-config 的入参类型校验。
// 重点覆盖:
//   - 0caef41 引入的回归:providerId=custom + 请求体里任意 baseURL +
//     不带 apiKey,不应该再能把库里存的 key(哪怕是别的 provider 的)发到
//     请求体里新填的端点。
//   - 本轮修复:不带 apiKey 时,请求体里的 baseURL 现在无条件忽略 ——
//     哪怕库里存的本来就是 custom provider,也只信库里存的端点。
//   - PUT 的 apiKey/baseURL 非字符串输入要 400,不能让 encryptSecret /
//     .trim() 抛出的原生 TypeError 透给客户端。
//
// 本文件全程不依赖真实网络访问:凡是会走到 probeLLMConfig(真的发起探测
// 请求)的场景,要么 monkeypatch globalThis.fetch 断网,要么只断言「新加的
// 门槛没有把它拦在半路」,不对探测本身的成败或状态码做断言 —— 那属于网络
// 环境,不属于这份代码的行为。
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

test('不带 apiKey 时,请求体里的 baseURL 被完全忽略 —— 出站请求只打库里存的端点', async () => {
  const app = await freshApp()
  const secretKey = 'sk-custom-000999'
  // 用字面量公网 IP 而不是域名:dns.lookup 对字面量 IP 不发真实网络请求
  // (本地直接返回),assertPublicBaseURL 走到这一步不依赖外网,测试保持 hermetic。
  upsertConfig(USER_ID, {
    providerId: 'custom', baseURL: 'https://8.8.8.8/v1',
    model: 'my-model', apiKey: secretKey,
  })

  const originalFetch = globalThis.fetch
  const seenUrls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seenUrls.push(typeof input === 'string' ? input : input.toString())
    // 断网:不需要真的打出去,记录到 URL 就已经证明了「打向谁」。
    throw new Error('fetch disabled in test')
  }) as typeof fetch

  let res
  try {
    res = await app.inject({
      method: 'POST',
      url: '/api/llm-config/test',
      // 攻击者试图借这个不带 apiKey 的请求,把库里存的明文 key 引到自己的端点。
      payload: { baseURL: 'https://attacker.invalid/v1' },
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  // 确认探测确实发生了(monkeypatch 的 fetch 至少被调用一次),而不是在更早的
  // 校验步骤就短路返回,导致下面的断言形同虚设。
  assert.ok(seenUrls.length > 0, 'probeLLMConfig 应该真的发起过一次出站请求')
  for (const url of seenUrls) {
    assert.ok(url.startsWith('https://8.8.8.8/'), `出站请求应该打库里存的端点,实际是 ${url}`)
    assert.ok(!url.includes('attacker'), `出站请求不应该包含请求体里的 attacker 端点,实际是 ${url}`)
  }
  // ok 字段必然是 false(monkeypatch 的 fetch 直接抛错),但这不是本测试要证明
  // 的东西 —— 探测结果不是重点,出站目标才是。响应体也不能出现明文 key。
  assert.equal(res.json().ok, false)
  assert.ok(!res.body.includes(secretKey))
})

test('PUT /llm-config:非字符串 apiKey → 400,不是原生 TypeError', async () => {
  const app = await freshApp()
  const res = await app.inject({
    method: 'PUT',
    url: '/api/llm-config',
    payload: { providerId: 'zhipu', model: 'glm-4-flash', apiKey: 123 },
  })
  assert.equal(res.statusCode, 400)
  const body = res.json()
  assert.equal(body.error, 'invalid_input')
  assert.match(body.message, /apiKey/)
  // 确认没有透出 Node 原生报错(比如 "The \"data\" argument must be of type string")。
  assert.ok(!body.message.includes('argument'))
})

test('PUT /llm-config:非字符串 baseURL → 400,不是原生 TypeError', async () => {
  const app = await freshApp()
  const res = await app.inject({
    method: 'PUT',
    url: '/api/llm-config',
    payload: { providerId: 'custom', model: 'my-model', apiKey: 'sk-user-123456', baseURL: 123 },
  })
  assert.equal(res.statusCode, 400)
  const body = res.json()
  assert.equal(body.error, 'invalid_input')
  assert.match(body.message, /baseURL/)
})
