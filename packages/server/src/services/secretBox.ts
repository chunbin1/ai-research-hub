// packages/server/src/services/secretBox.ts
//
// 用户自带 API key 的对称加密。AES-256-GCM,主密钥来自环境变量
// LLM_KEY_SECRET(64 位 hex = 32 字节,用 `openssl rand -hex 32` 生成)。
//
// AAD 绑定 user_id:即使有人能直接改数据库,也没法把 A 的密文搬到 B 行上冒用。
//
// 主密钥每次调用现读,不在模块加载时缓存 —— 这样测试可以逐用例切换密钥,
// 也让"没配密钥"退化成可捕获的异常而不是启动崩溃。
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_LEN = 12
const TAG_LEN = 16
const HINT_MIN_LEN = 12

/** 服务端没配 LLM_KEY_SECRET(或格式不对)—— BYOK 功能不可用。 */
export class SecretBoxUnavailableError extends Error {
  constructor() { super('LLM_KEY_SECRET 未配置或格式不正确') }
}

/** 密文解不开 —— 主密钥换过、密文损坏,或 AAD 不匹配。 */
export class SecretDecryptError extends Error {}

function masterKey(): Buffer | null {
  const hex = process.env.LLM_KEY_SECRET
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) return null
  return Buffer.from(hex, 'hex')
}

export function isSecretBoxAvailable(): boolean {
  return masterKey() !== null
}

/** → base64(iv(12) ‖ authTag(16) ‖ ciphertext) */
export function encryptSecret(plain: string, aad: string): string {
  const key = masterKey()
  if (!key) throw new SecretBoxUnavailableError()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function decryptSecret(blob: string, aad: string): string {
  const key = masterKey()
  if (!key) throw new SecretBoxUnavailableError()

  const raw = Buffer.from(blob, 'base64')
  if (raw.length <= IV_LEN + TAG_LEN) throw new SecretDecryptError('密文长度不足')

  const iv = raw.subarray(0, IV_LEN)
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = raw.subarray(IV_LEN + TAG_LEN)

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    // 不透传原始错误 —— 它可能带上密钥材料的细节。
    throw new SecretDecryptError('解密失败 —— 主密钥可能已更换,或配置已损坏')
  }
}

/** 用于 UI 回显的脱敏形式。短到不足以安全露出时,一个字符都不露。 */
export function keyHint(key: string): string {
  if (key.length < HINT_MIN_LEN) return '……'
  return `${key.slice(0, 4)}……${key.slice(-4)}`
}
