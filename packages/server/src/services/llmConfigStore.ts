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

  // 省略 apiKey 时会保留原密文。如果同时允许换 provider 或换 custom 端点,
  // 就等于把用户为「原服务商」填的 key 未经确认地发去一个新地方 —— PUT 这条
  // 路径本身没有测试连接那种「用请求体新值探测」的语义,一旦落库,
  // resolveLLMConfig 之后每次问答都会用旧 key 打新端点。
  // 所以只允许「模型改了、服务商和端点都没变」时省略 apiKey;
  // 这也是 enabled-only 开关切换(provider/baseURL/model 原样回传)依赖的路径,
  // 必须保留。
  if (!input.apiKey && existing) {
    const providerChanged = preset.id !== existing.provider
    const endpointChanged = baseUrl !== existing.base_url
    if (providerChanged || endpointChanged) {
      throw new LLMConfigInputError('更换服务商或端点时必须重新填写 API key')
    }
  }

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
 * 「测试连接」专用:只解密库里存的 key,不管 enabled 开关,也不决定
 * providerId / model / baseURL —— 那几项测试连接要用请求体里的表单当前值
 * (用户很可能刚改了模型名还没点保存),不是库里的旧值,交给调用方决定。
 * 没配置过时返回 null,由调用方报「尚未配置自己的模型」。
 */
export function getStoredApiKey(user: User): { row: UserLLMConfigRow; apiKey: string } | null {
  const row = getConfig(user.id)
  if (!row) return null
  try {
    const apiKey = decryptSecret(row.key_cipher, user.id)
    return { row, apiKey }
  } catch (err) {
    if (err instanceof SecretDecryptError || err instanceof SecretBoxUnavailableError) {
      throw new LLMConfigDecryptError()
    }
    throw err
  }
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
