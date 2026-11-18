// WHALES=off 关掉路由和 cron，与 SIGNALS=off 同一风格。
// SEC 拒绝没有联系方式的 User-Agent。没配就不去打，避免一启动就被封。

export function isWhalesEnabled(): boolean {
  return process.env.WHALES !== 'off'
}

/** 完整 UA 优先；否则用联系邮箱拼一条。都没有就返回 null。 */
export function resolveSecUserAgent(): string | null {
  const explicit = process.env.SEC_USER_AGENT?.trim()
  if (explicit) return explicit
  const email = process.env.WHALES_CONTACT_EMAIL?.trim()
  if (email) return `ai-research-hub whales-13f (${email})`
  return null
}
