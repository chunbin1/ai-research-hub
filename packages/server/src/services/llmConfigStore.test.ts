import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initLLMConfigTable,
  getConfig,
  upsertConfig,
  deleteConfig,
  resolveLLMConfig,
  LLMConfigDecryptError,
  LLMConfigInputError,
} from './llmConfigStore.ts'
import type { User } from './userStore.ts'

process.env.LLM_KEY_SECRET = 'a'.repeat(64)
process.env.ZHIPU_API_KEY = 'server-key'
process.env.ZHIPU_MODEL = 'glm-4-flash'
delete process.env.ANTHROPIC_API_KEY
delete process.env.LLM_PROVIDER

const USER: User = {
  id: 'usr_1', github_id: 1, username: 'a', avatar_url: null,
  message_count: 0, unlimited: 0, is_admin: 0, created_at: '',
}

function freshDb() {
  const db = new Database(':memory:')
  initLLMConfigTable(db)
  return db
}

test('无配置时 resolveLLMConfig 返回站长默认', () => {
  freshDb()
  const cfg = resolveLLMConfig(USER)
  assert.equal(cfg.source, 'server')
  assert.equal(cfg.providerId, 'zhipu')
  assert.equal(cfg.apiKey, 'server-key')
})

test('保存后 resolveLLMConfig 返回用户配置,apiKey 正确解出', () => {
  freshDb()
  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-user-123456' })
  const cfg = resolveLLMConfig(USER)
  assert.equal(cfg.source, 'user')
  assert.equal(cfg.providerId, 'deepseek')
  assert.equal(cfg.kind, 'openai')
  assert.equal(cfg.baseURL, 'https://api.deepseek.com/v1')
  assert.deepEqual(cfg.models, ['deepseek-chat'])
  assert.equal(cfg.apiKey, 'sk-user-123456')
})

test('enabled=0 时回落到站长默认,但配置仍在库里', () => {
  freshDb()
  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-user-123456' })
  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat', enabled: false })
  assert.equal(resolveLLMConfig(USER).source, 'server')
  assert.equal(getConfig('usr_1')?.enabled, 0)
})

test('custom provider 用用户填的 baseURL', () => {
  freshDb()
  upsertConfig('usr_1', {
    providerId: 'custom', baseURL: 'https://llm.example.com/v1',
    model: 'my-model', apiKey: 'sk-user-123456',
  })
  const cfg = resolveLLMConfig(USER)
  assert.equal(cfg.baseURL, 'https://llm.example.com/v1')
  assert.equal(cfg.providerId, 'custom')
})

test('anthropic provider 的 kind 是 anthropic 且无 baseURL', () => {
  freshDb()
  upsertConfig('usr_1', { providerId: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-ant-123456' })
  const cfg = resolveLLMConfig(USER)
  assert.equal(cfg.kind, 'anthropic')
  assert.equal(cfg.baseURL, undefined)
})

test('省略 apiKey 更新时保留原密文', () => {
  freshDb()
  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-user-123456' })
  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-reasoner' })
  const cfg = resolveLLMConfig(USER)
  assert.equal(cfg.apiKey, 'sk-user-123456')
  assert.deepEqual(cfg.models, ['deepseek-reasoner'])
})

test('首次创建时省略 apiKey 报 LLMConfigInputError', () => {
  freshDb()
  assert.throws(
    () => upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat' }),
    LLMConfigInputError,
  )
})

test('未知 providerId 报 LLMConfigInputError', () => {
  freshDb()
  assert.throws(
    () => upsertConfig('usr_1', { providerId: 'nope', model: 'm', apiKey: 'sk-user-123456' }),
    LLMConfigInputError,
  )
})

test('custom 缺 baseURL 报 LLMConfigInputError', () => {
  freshDb()
  assert.throws(
    () => upsertConfig('usr_1', { providerId: 'custom', model: 'm', apiKey: 'sk-user-123456' }),
    LLMConfigInputError,
  )
})

test('非 custom 时 baseURL 被忽略并存 NULL', () => {
  freshDb()
  upsertConfig('usr_1', {
    providerId: 'deepseek', baseURL: 'https://evil.example.com',
    model: 'deepseek-chat', apiKey: 'sk-user-123456',
  })
  assert.equal(getConfig('usr_1')?.base_url, null)
  assert.equal(resolveLLMConfig(USER).baseURL, 'https://api.deepseek.com/v1')
})

test('model 为空白报 LLMConfigInputError', () => {
  freshDb()
  assert.throws(
    () => upsertConfig('usr_1', { providerId: 'deepseek', model: '   ', apiKey: 'sk-user-123456' }),
    LLMConfigInputError,
  )
})

test('key_hint 露前 4 后 4,短 key 不露字符,且从不存明文', () => {
  freshDb()
  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-abcdefghijkl' })
  const row = getConfig('usr_1')!
  assert.equal(row.key_hint, 'sk-a……ijkl')
  assert.ok(!row.key_cipher.includes('sk-abcdefghijkl'))

  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'short' })
  assert.equal(getConfig('usr_1')!.key_hint, '……')
})

test('主密钥换过导致解密失败时抛 LLMConfigDecryptError', () => {
  freshDb()
  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-user-123456' })
  const prev = process.env.LLM_KEY_SECRET
  process.env.LLM_KEY_SECRET = 'b'.repeat(64)
  try {
    assert.throws(() => resolveLLMConfig(USER), LLMConfigDecryptError)
  } finally {
    process.env.LLM_KEY_SECRET = prev
  }
})

test('LLM_KEY_SECRET 被移除导致 SecretBoxUnavailableError 时也抛 LLMConfigDecryptError,不回落站长 key', () => {
  freshDb()
  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-user-123456' })
  const prev = process.env.LLM_KEY_SECRET
  delete process.env.LLM_KEY_SECRET
  try {
    assert.throws(() => resolveLLMConfig(USER), LLMConfigDecryptError)
  } finally {
    process.env.LLM_KEY_SECRET = prev
  }
})

test('更换 provider 时省略 apiKey 报 LLMConfigInputError,且不改动库里的密文', () => {
  freshDb()
  upsertConfig('usr_1', { providerId: 'zhipu', model: 'glm-4-flash', apiKey: 'sk-zhipu-super-secret-000111' })
  const before = getConfig('usr_1')!
  assert.throws(
    () => upsertConfig('usr_1', { providerId: 'custom', baseURL: 'https://attacker.example.com/v1', model: 'glm-4-flash' }),
    LLMConfigInputError,
  )
  const after = getConfig('usr_1')!
  assert.equal(after.provider, 'zhipu')
  assert.equal(after.key_cipher, before.key_cipher)
})

test('custom provider 更换 baseURL 时省略 apiKey 报 LLMConfigInputError', () => {
  freshDb()
  upsertConfig('usr_1', {
    providerId: 'custom', baseURL: 'https://llm.example.com/v1',
    model: 'my-model', apiKey: 'sk-user-123456',
  })
  assert.throws(
    () => upsertConfig('usr_1', { providerId: 'custom', baseURL: 'https://attacker.example.com/v1', model: 'my-model' }),
    LLMConfigInputError,
  )
  assert.equal(getConfig('usr_1')?.base_url, 'https://llm.example.com/v1')
})

test('只改模型、provider 和端点都不变时,省略 apiKey 仍然放行(设计承诺的场景)', () => {
  freshDb()
  upsertConfig('usr_1', {
    providerId: 'custom', baseURL: 'https://llm.example.com/v1',
    model: 'my-model', apiKey: 'sk-user-123456',
  })
  upsertConfig('usr_1', { providerId: 'custom', baseURL: 'https://llm.example.com/v1', model: 'my-model-v2' })
  const cfg = resolveLLMConfig(USER)
  assert.equal(cfg.apiKey, 'sk-user-123456')
  assert.deepEqual(cfg.models, ['my-model-v2'])
})

test('仅切换 enabled(设置页开关)、provider/baseURL/model 原样回传,省略 apiKey 仍然放行', () => {
  freshDb()
  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-user-123456' })
  // 复刻 SettingsPage.onToggleEnabled 的调用形态:非 custom provider 时
  // baseURL 传 `data.config.baseURL ?? undefined`,即 undefined 而非 null ——
  // 库里存的却是 null,若比较不做同一套归一化处理容易在这里误判「端点变了」。
  upsertConfig('usr_1', { providerId: 'deepseek', baseURL: undefined, model: 'deepseek-chat', enabled: false })
  const row = getConfig('usr_1')!
  assert.equal(row.enabled, 0)
  assert.equal(row.provider, 'deepseek')
})

test('deleteConfig 后回落到站长默认', () => {
  freshDb()
  upsertConfig('usr_1', { providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-user-123456' })
  deleteConfig('usr_1')
  assert.equal(getConfig('usr_1'), null)
  assert.equal(resolveLLMConfig(USER).source, 'server')
})
