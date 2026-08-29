import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withModelFallback, isQuotaError, describeLLMError, serverLLMConfig } from './llm.ts'
import Database from 'better-sqlite3'
import { initSiteSettingsTable, setSetting, deleteSetting, DEFAULT_MODEL_KEY } from './services/siteSettingsStore.ts'

/** 造一个带 status 的错误,模拟 SDK 抛出的 HTTP 错误 */
function httpError(status: number, message = 'boom'): Error {
  return Object.assign(new Error(message), { status })
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = ''
  for await (const chunk of gen) out += chunk
  return out
}

async function* yields(...chunks: string[]): AsyncGenerator<string> {
  for (const c of chunks) yield c
}

async function* throws(err: Error): AsyncGenerator<string> {
  throw err
  yield '' // 让它成为 generator
}

test('isQuotaError:429 / quota / insufficient / billing 都算配额错误', () => {
  assert.equal(isQuotaError(httpError(429)), true)
  assert.equal(isQuotaError(new Error('Insufficient balance')), true)
  assert.equal(isQuotaError(new Error('quota exceeded')), true)
  assert.equal(isQuotaError(new Error('billing not active')), true)
  assert.equal(isQuotaError(httpError(401)), false)
  assert.equal(isQuotaError(new Error('model not found')), false)
})

test('withModelFallback:第一个模型正常时直接返回,不碰后面的', async () => {
  const tried: string[] = []
  const out = await collect(withModelFallback(['a', 'b'], m => { tried.push(m); return yields('hello') }))
  assert.equal(out, 'hello')
  assert.deepEqual(tried, ['a'])
})

test('withModelFallback:第一个模型配额耗尽时切到第二个', async () => {
  const tried: string[] = []
  const out = await collect(withModelFallback(['a', 'b'], m => {
    tried.push(m)
    return m === 'a' ? throws(httpError(429)) : yields('from-b')
  }))
  assert.equal(out, 'from-b')
  assert.deepEqual(tried, ['a', 'b'])
})

test('withModelFallback:非配额错误直接抛,不 fallback', async () => {
  const tried: string[] = []
  await assert.rejects(
    () => collect(withModelFallback(['a', 'b'], m => { tried.push(m); return throws(httpError(401)) })),
    /boom/,
  )
  assert.deepEqual(tried, ['a'])
})

test('withModelFallback:单模型(用户配置)遇配额错误直接抛,没有可切的下一个', async () => {
  const tried: string[] = []
  await assert.rejects(
    () => collect(withModelFallback(['only'], m => { tried.push(m); return throws(httpError(429)) })),
    /boom/,
  )
  assert.deepEqual(tried, ['only'])
})

test('withModelFallback:最后一个模型也配额耗尽时抛出', async () => {
  await assert.rejects(
    () => collect(withModelFallback(['a', 'b'], () => throws(httpError(429)))),
    /boom/,
  )
})

test('describeLLMError:按状态码给出可读原因', () => {
  assert.match(describeLLMError(httpError(401)), /key/)
  assert.match(describeLLMError(httpError(403)), /key/)
  assert.match(describeLLMError(httpError(404)), /模型/)
  assert.match(describeLLMError(httpError(429)), /频控|额度/)
  assert.match(describeLLMError(httpError(500)), /上游/)
  assert.equal(describeLLMError(new Error('随便什么错')), '随便什么错')
})

test('serverLLMConfig:按 env 决定 provider,source 恒为 server', () => {
  const snapshot = { ...process.env }
  try {
    delete process.env.LLM_PROVIDER
    delete process.env.ANTHROPIC_API_KEY
    process.env.ZHIPU_API_KEY = 'zk'
    process.env.ZHIPU_MODEL = 'glm-a, glm-b'
    const zhipu = serverLLMConfig()
    assert.equal(zhipu.kind, 'openai')
    assert.equal(zhipu.providerId, 'zhipu')
    assert.equal(zhipu.source, 'server')
    assert.deepEqual(zhipu.models, ['glm-a', 'glm-b'])

    process.env.ANTHROPIC_API_KEY = 'ak'
    process.env.LLM_PROVIDER = 'anthropic'
    const anthropic = serverLLMConfig()
    assert.equal(anthropic.kind, 'anthropic')
    assert.equal(anthropic.models.length, 1)

    delete process.env.LLM_PROVIDER
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ZHIPU_API_KEY
    assert.throws(() => serverLLMConfig(), /No LLM provider configured/)
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in snapshot)) delete process.env[k]
    Object.assign(process.env, snapshot)
  }
})

// serverLLMConfig 的模型来源优先级。
// 注:node:test 每个测试文件跑在独立子进程里,这里对 process.env 和模块级
// _db 的改动不会串到别的测试文件。
function siteDb() {
  initSiteSettingsTable(new Database(':memory:'))
  process.env.ZHIPU_API_KEY = 'server-key'
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.LLM_PROVIDER
}

test('serverLLMConfig:库里没有 override 时用 .env 的 ZHIPU_MODEL', () => {
  siteDb()
  deleteSetting(DEFAULT_MODEL_KEY)
  process.env.ZHIPU_MODEL = 'glm-4.7'
  assert.deepEqual(serverLLMConfig().models, ['glm-4.7'])
})

test('serverLLMConfig:.env 里的逗号降级链解析成多个模型', () => {
  siteDb()
  deleteSetting(DEFAULT_MODEL_KEY)
  process.env.ZHIPU_MODEL = 'glm-4.7, glm-4-flash'
  assert.deepEqual(serverLLMConfig().models, ['glm-4.7', 'glm-4-flash'])
})

test('serverLLMConfig:库里有 override 时优先于 .env', () => {
  siteDb()
  process.env.ZHIPU_MODEL = 'glm-4.7'
  setSetting(DEFAULT_MODEL_KEY, 'glm-4.7-flash')
  assert.deepEqual(serverLLMConfig().models, ['glm-4.7-flash'])
})

test('serverLLMConfig:override 是单个模型名时降级链只剩它自己', () => {
  siteDb()
  process.env.ZHIPU_MODEL = 'glm-4.7,glm-4-flash'
  setSetting(DEFAULT_MODEL_KEY, 'glm-4.7-flash')
  assert.deepEqual(serverLLMConfig().models, ['glm-4.7-flash'])
})

test('serverLLMConfig:ZHIPU_MODEL 是空串时回落到内置默认,不是空数组', () => {
  siteDb()
  deleteSetting(DEFAULT_MODEL_KEY)
  process.env.ZHIPU_MODEL = ''
  assert.deepEqual(serverLLMConfig().models, ['glm-4.7-flash'])
})

test('serverLLMConfig:anthropic 分支同样吃 override', () => {
  initSiteSettingsTable(new Database(':memory:'))
  process.env.ANTHROPIC_API_KEY = 'sk-ant'
  process.env.LLM_PROVIDER = 'anthropic'
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-5'
  setSetting(DEFAULT_MODEL_KEY, 'claude-haiku-4-5-20251001')
  const cfg = serverLLMConfig()
  assert.equal(cfg.kind, 'anthropic')
  assert.deepEqual(cfg.models, ['claude-haiku-4-5-20251001'])
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.LLM_PROVIDER
})
