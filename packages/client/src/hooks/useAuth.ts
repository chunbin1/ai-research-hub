import { useState, useEffect, useCallback } from 'react'
import { readCache, writeCache, clearCache } from '../lib/storage'

export interface AuthUser {
  id: string
  username: string
  avatarUrl: string | null
  messageCount: number
  limit: number
  unlimited: boolean
  isAdmin: boolean
  /** null when unlimited */
  remaining: number | null
}

export interface UseAuthReturn {
  user: AuthUser | null
  /** 还没向服务端确认过登录态。user 有值(来自缓存)时它仍可能为 true */
  loading: boolean
  login: () => void
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

/**
 * 上一次确认过的登录态。只用来让**刷新时首帧就画对顶栏** ——
 * 不缓存的话每次刷新都是「先按未登录画一遍,300ms 后换成头像 + 管理员栏目」,
 * 顶栏高度和栏目行宽度跟着跳一下。
 *
 * 这份缓存不是权限:isAdmin 被人手改成 true 也只是多看见几个按钮,
 * 所有管理员接口在服务端各自校验(见 server 侧的 requireAdmin)。
 */
const CACHE_KEY = 'arh.auth.user'

/**
 * 同一次加载里有多个组件调 useAuth(首页就是 HomePage + SiteHeader 两处),
 * 各自 fetch 会并发打两次 /api/auth/me,两份状态还可能先后落地、让顶栏抖两次。
 * 这里共享在途请求:先到的发起,后到的搭车,拿到结果各自 setState(同一帧内)。
 */
let inflight: Promise<AuthUser | null> | null = null

function fetchMe(): Promise<AuthUser | null> {
  inflight ??= fetch('/api/auth/me')
    .then(res => (res.ok ? (res.json() as Promise<AuthUser>) : null))
    .catch(() => null)
    // 清掉在途标记要早于调用方拿到结果,后续的 refresh() 才会真的重新请求
    .finally(() => { inflight = null })
  return inflight
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(() => readCache<AuthUser>(CACHE_KEY))
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await fetchMe()
    setUser(next)
    if (next) writeCache(CACHE_KEY, next)
    else clearCache(CACHE_KEY)
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Re-fetch the remaining quota after each send (useChat dispatches this).
  useEffect(() => {
    const handler = (): void => { void refresh() }
    window.addEventListener('auth:refresh', handler)
    return () => window.removeEventListener('auth:refresh', handler)
  }, [refresh])

  const login = useCallback((): void => {
    window.location.href = '/api/auth/github'
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      clearCache(CACHE_KEY)
      setUser(null)
    }
  }, [])

  return { user, loading, login, logout, refresh }
}
