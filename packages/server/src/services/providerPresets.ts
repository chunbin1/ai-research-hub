// packages/server/src/services/providerPresets.ts
//
// 预置 provider 常量表 + 自定义 baseURL 的安全校验。
//
// suggestedModels 只是下拉建议,不是白名单 —— 用户手填任意模型名都必须放行。
// 模型迭代速度远快于本项目的发版速度,任何白名单都会先于代码过期。
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export interface Preset {
  id: string
  label: string
  kind: 'openai' | 'anthropic'
  /** anthropic 原生走 SDK 默认端点,为 null;custom 由用户填,也为 null */
  baseURL: string | null
  suggestedModels: string[]
  /** 需要用户自填 baseURL */
  custom?: true
}

export const PRESETS: Preset[] = [
  {
    id: 'zhipu',
    label: '智谱 GLM',
    kind: 'openai',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    suggestedModels: ['glm-4.7', 'glm-4-flash'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseURL: 'https://api.openai.com/v1',
    suggestedModels: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseURL: null,
    suggestedModels: ['claude-sonnet-4-5', 'claude-opus-4-1'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'moonshot',
    label: 'Moonshot',
    kind: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    suggestedModels: ['moonshot-v1-8k', 'moonshot-v1-32k'],
  },
  {
    id: 'custom',
    label: '自定义(OpenAI 兼容)',
    kind: 'openai',
    baseURL: null,
    suggestedModels: [],
    custom: true,
  },
]

export function getPreset(id: string): Preset | null {
  return PRESETS.find(p => p.id === id) ?? null
}

/** baseURL 指向了内网 / 非法地址,已拒绝。 */
export class BaseURLRejectedError extends Error {}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0) return true                       // 0.0.0.0/8
  if (a === 10) return true                      // 10.0.0.0/8
  if (a === 127) return true                     // 127.0.0.0/8
  if (a === 169 && b === 254) return true        // 169.254.0.0/16(云元数据端点)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true        // 192.168.0.0/16
  return false
}

/** 认不出的输入一律当作私网 —— 拒绝比放行安全。 */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isPrivateIPv4(ip)
  if (version !== 6) return true

  const lower = ip.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return isPrivateIPv4(mapped[1])
  if (lower === '::1' || lower === '::') return true

  const head = parseInt(lower.split(':')[0] || '0', 16)
  if ((head & 0xfe00) === 0xfc00) return true    // fc00::/7  ULA
  if ((head & 0xffc0) === 0xfe80) return true    // fe80::/10 链路本地
  return false
}

export function validateBaseURLSyntax(
  raw: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL
  try { url = new URL(raw) } catch { return { ok: false, reason: 'baseURL 格式不正确' } }
  if (url.protocol !== 'https:') return { ok: false, reason: 'baseURL 必须以 https:// 开头' }
  if (!url.hostname) return { ok: false, reason: 'baseURL 缺少主机名' }
  return { ok: true, url }
}

/**
 * 语法校验 + DNS 解析后的私网拒绝。
 *
 * 这个函数在两处调用:保存配置时(给用户即时反馈),以及每次问答调用前
 * (防 DNS rebinding —— 保存时解析到公网、调用时解析到内网)。
 */
export async function assertPublicBaseURL(raw: string): Promise<void> {
  const syntax = validateBaseURLSyntax(raw)
  if (!syntax.ok) throw new BaseURLRejectedError(syntax.reason)

  // URL 会把 IPv6 字面量包成 [::1],lookup 需要裸地址
  const host = syntax.url.hostname.replace(/^\[|\]$/g, '')

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new BaseURLRejectedError('baseURL 域名解析失败')
  }
  if (!addresses.length) throw new BaseURLRejectedError('baseURL 域名解析失败')

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new BaseURLRejectedError('baseURL 指向内网地址,已拒绝')
    }
  }
}
