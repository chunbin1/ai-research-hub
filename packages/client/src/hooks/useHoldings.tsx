import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { HoldingsSnapshot } from '../types'

interface HoldingsState {
  snapshot: HoldingsSnapshot | null
  loading: boolean
  error: string | null
}

const HoldingsContext = createContext<HoldingsState | null>(null)

/**
 * StrictMode 会把 effect 挂上再卸掉再挂上。共享这一次在途请求，
 * 开发环境也不会对同一次进入打出第二个 GET /api/holdings。
 */
let inflight: Promise<HoldingsSnapshot> | null = null

function loadHoldings(): Promise<HoldingsSnapshot> {
  inflight ??= api.getHoldings().finally(() => { inflight = null })
  return inflight
}

/**
 * 顶栏和持仓页共用这一份结果。挂在 SiteLayout 上，整页只请求一次 GET /api/holdings。
 * 失败当成没有快照：入口藏起来；持仓页自己决定是显示错误还是跳回首页。
 * 上传之后刷新页面会重新请求，不做实时推送。
 */
export function HoldingsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<HoldingsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadHoldings()
      .then(next => { if (!cancelled) setSnapshot(next) })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : '持仓加载失败')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <HoldingsContext.Provider value={{ snapshot, loading, error }}>
      {children}
    </HoldingsContext.Provider>
  )
}

export function useHoldings(): HoldingsState {
  const value = useContext(HoldingsContext)
  if (!value) throw new Error('useHoldings 必须放在 HoldingsProvider 里')
  return value
}
