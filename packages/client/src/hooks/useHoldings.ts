import { useEffect, useState } from 'react'
import { api } from '../api'
import type { HoldingsSnapshot } from '../types'

/**
 * 顶栏和持仓页各自问一次「现在有没有快照」。
 * 失败当成没有:入口藏起来,页面自己决定是跳回首页还是显示错误。
 */
export function useHoldings() {
  const [snapshot, setSnapshot] = useState<HoldingsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getHoldings()
      .then(next => { if (!cancelled) setSnapshot(next) })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : '持仓加载失败')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { snapshot, loading, error }
}
