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

/**
 * 把 IPv6 地址展开成 8 个十六进制分组(数值)。
 *
 * 需要同时处理两种输入形态:
 *   - 常规压缩形式,如 `::1`、`fe80::1`(可能含 `::` 压缩)
 *   - 尾部内嵌点分十进制 IPv4 的形式,如 `::ffff:127.0.0.1`
 * 注意 Node 的 WHATWG URL 解析器会把中括号字面量里的 v4-mapped 地址
 * 序列化成纯十六进制分组形式(如 `::ffff:7f00:1`),两种形态都要能解析。
 * 解析失败返回 null,调用方按保守拒绝处理。
 */
function expandIPv6Groups(raw: string): number[] | null {
  let ip = raw

  // 尾部内嵌点分十进制 IPv4:把它转换成两个十六进制分组,复用后面的通用展开逻辑
  if (ip.includes('.')) {
    const lastColonIdx = ip.lastIndexOf(':')
    if (lastColonIdx === -1) return null
    const v4 = ip.slice(lastColonIdx + 1)
    const parts = v4.split('.').map(Number)
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
    const hex1 = (((parts[0] << 8) | parts[1]) >>> 0).toString(16)
    const hex2 = (((parts[2] << 8) | parts[3]) >>> 0).toString(16)
    ip = `${ip.slice(0, lastColonIdx + 1)}${hex1}:${hex2}`
  }

  const halves = ip.split('::')
  if (halves.length > 2) return null // 非法:多个 ::

  let groups: string[]
  if (halves.length === 1) {
    groups = ip.split(':')
  } else {
    const head = halves[0] ? halves[0].split(':') : []
    const tail = halves[1] ? halves[1].split(':') : []
    const fillCount = 8 - head.length - tail.length
    if (fillCount < 0) return null
    groups = [...head, ...Array(fillCount).fill('0'), ...tail]
  }
  if (groups.length !== 8) return null

  const nums = groups.map(g => parseInt(g, 16))
  if (nums.some(n => Number.isNaN(n) || n < 0 || n > 0xffff)) return null
  return nums
}

/** 认不出的输入一律当作私网 —— 拒绝比放行安全。 */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isPrivateIPv4(ip)
  if (version !== 6) return true

  const groups = expandIPv6Groups(ip.toLowerCase())
  if (!groups) return true // 解析失败,保守拒绝

  // ::(全零,未指定地址)
  if (groups.every(g => g === 0)) return true

  // ::1(回环),按完整 8 分组比较,不依赖字符串分割
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
      groups[4] === 0 && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) return true

  // v4-mapped:::ffff:a.b.c.d,分组 0-4 全零、分组 5 为 0xffff,后两组还原成 IPv4 再复用现有判断
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
      groups[4] === 0 && groups[5] === 0xffff) {
    const g6 = groups[6]
    const g7 = groups[7]
    const a = (g6 >> 8) & 0xff
    const b = g6 & 0xff
    const c = (g7 >> 8) & 0xff
    const d = g7 & 0xff
    return isPrivateIPv4(`${a}.${b}.${c}.${d}`)
  }

  const head = groups[0]
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
