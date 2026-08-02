// packages/server/src/services/llmConfigStore.ts
//
// 每用户一份模型配置(user_id 主键)。key 密文存库,明文只在 resolveLLMConfig
// 的返回值里短暂存在,交给 llm.ts 后即随请求结束。
import type { DB } from './db.js'
import type { User } from './userStore.js'
import type { LLMConfig } from '../types.js'
import { serverLLMConfig } from '../llm.js'
import { encryptSecret, decryptSecret, keyHint, SecretDecryptError, SecretBoxUnavailableError } from './secretBox.js'
import { getPreset } from './providerPresets.js'

export interface UserLLMConfigRow {
  user_id: string
  provider: string
  base_url: string | null
  model: string
  key_cipher: string
  key_hint: string
  enabled: number
  created_at: string
  updated_at: string
}

export interface ConfigInput {
  providerId: string
  baseURL?: string | null
  model: string
  /** 省略 = 保留原密文。首次创建时必填。 */
  apiKey?: string
  /** 省略 = 新建时默认 true,更新时保留原值。 */
  enabled?: boolean
}

/** 用户提交的配置不合法。消息可直接展示给用户。 */
export class LLMConfigInputError extends Error {}

/** 库里的密文解不开 —— 主密钥换过、数据损坏,或主密钥缺失/不可用。 */
export class LLMConfigDecryptError extends Error {
  constructor() { super('模型配置已失效,请重新填写 API key') }
}

let _db: DB | null = null

export function initLLMConfigTable(db: DB): void {
  _db = db
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_llm_configs (
      user_id    TEXT PRIMARY KEY,
      provider   TEXT NOT NULL,
      base_url   TEXT,
      model      TEXT NOT NULL,
      key_cipher TEXT NOT NULL,
      key_hint   TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

function db(): DB {
  if (!_db) throw new Error('llmConfigStore not initialized — call initLLMConfigTable() first')
  return _db
}

export function getConfig(userId: string): UserLLMConfigRow | null {
  return (db().prepare('SELECT * FROM user_llm_configs WHERE user_id = ?').get(userId) as
    UserLLMConfigRow | undefined) ?? null
}

export function deleteConfig(userId: string): void {
  db().prepare('DELETE FROM user_llm_configs WHERE user_id = ?').run(userId)
}

export function upsertConfig(userId: string, input: ConfigInput): void {
  const preset = getPreset(input.providerId)
  if (!preset) throw new LLMConfigInputError(`未知的 provider:${input.providerId}`)

  const model = input.model?.trim()
  if (!model) throw new LLMConfigInputError('模型名不能为空')

  // 只有 custom 认 baseURL;其余一律存 NULL,运行时查预置表。
  // 这样用户改不了预置 provider 的端点,少一个 SSRF 面。
  let baseUrl: string | null = null
  if (preset.custom) {
    const raw = input.baseURL?.trim()
    if (!raw) throw new LLMConfigInputError('自定义 provider 必须填写 baseURL')
    baseUrl = raw
  }

  const existing = getConfig(userId)
  if (!input.apiKey && !existing) throw new LLMConfigInputError('首次配置必须填写 API key')

  const now = new Date().toISOString()
  const cipher = input.apiKey ? encryptSecret(input.apiKey, userId) : existing!.key_cipher
  const hint = input.apiKey ? keyHint(input.apiKey) : existing!.key_hint
  const enabled = input.enabled ?? (existing ? existing.enabled === 1 : true)

  db().prepare(`
    INSERT INTO user_llm_configs
      (user_id, provider, base_url, model, key_cipher, key_hint, enabled, created_at, updated_at)
    VALUES (@user_id, @provider, @base_url, @model, @key_cipher, @key_hint, @enabled, @created_at, @updated_at)
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider,
      base_url = excluded.base_url,
      model = excluded.model,
      key_cipher = excluded.key_cipher,
      key_hint = excluded.key_hint,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run({
    user_id: userId,
    provider: preset.id,
    base_url: baseUrl,
    model,
    key_cipher: cipher,
    key_hint: hint,
    enabled: enabled ? 1 : 0,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  })
}

/**
 * 决定这次请求用谁的 key。调用方靠返回值的 `source` 判断要不要计限次 ——
 * 所以这个函数必须在限次预留**之前**调用。
 */
export function resolveLLMConfig(user: User): LLMConfig {
  const row = getConfig(user.id)
  if (!row || row.enabled !== 1) return serverLLMConfig()

  const preset = getPreset(row.provider)
  // 预置表里删掉过某个 provider 时,老配置会走到这里 —— 当作没配置。
  if (!preset) return serverLLMConfig()

  let apiKey: string
  try {
    apiKey = decryptSecret(row.key_cipher, user.id)
  } catch (err) {
    // SecretDecryptError:主密钥换过或密文损坏。
    // SecretBoxUnavailableError:LLM_KEY_SECRET 曾经配过(否则用户存不进配置),
    // 现在被移除或改坏了 —— 服务端此刻无法解密任何人的 key。
    // 两种情况都不能静默回落到站长 key(那等于把用户偷偷切到别的模型,
    // 同时消耗站长额度),必须让用户知道要重新填 key。
    if (err instanceof SecretDecryptError || err instanceof SecretBoxUnavailableError) {
      throw new LLMConfigDecryptError()
    }
    throw err
  }

  const baseURL = preset.custom ? (row.base_url ?? undefined) : (preset.baseURL ?? undefined)

  return {
    kind: preset.kind,
    providerId: preset.id,
    baseURL,
    models: [row.model],
    apiKey,
    source: 'user',
  }
}
