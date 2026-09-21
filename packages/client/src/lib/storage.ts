/**
 * 容错的 localStorage 读写。
 *
 * 这里的每一次访问都必须包在 try/catch 里:Safari 无痕模式、浏览器禁用站点数据、
 * 以及本仓库的测试环境(Node 26 + happy-dom 下 `localStorage` 直接是 undefined)
 * 都会让 `localStorage.getItem` 抛出。缓存只是用来让刷新时少抖一下,
 * **读不到就当没缓存**,任何一次失败都不该影响页面正确性。
 */

/** 读一份缓存;不存在、解析失败、存储不可用都返回 null */
export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

/** 写一份缓存;写不进去(配额满 / 无痕模式)静默忽略 */
export function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 缓存写失败不影响功能,只是下次刷新会退回骨架 */
  }
}

/** 删一份缓存(登出 / 服务端说没有这份数据时) */
export function clearCache(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 同 writeCache */
  }
}
