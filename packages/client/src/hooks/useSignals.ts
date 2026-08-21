import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { SignalRow } from '../types'

export function useSignals() {
  const [rows, setRows] = useState<SignalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setRows(await api.listSignals())
    } catch (err) {
      setError(err instanceof Error ? err.message : '看板加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // 扫描要打一圈 Yahoo,几十秒起步 —— scanning 用来把按钮置于 loading 态
  const scan = useCallback(async () => {
    setScanning(true); setError(null)
    try {
      await api.scanSignals()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败')
    } finally { setScanning(false) }
  }, [refresh])

  const extract = useCallback(async () => {
    setScanning(true); setError(null)
    try {
      await api.extractWatchlist()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '抽取失败')
    } finally { setScanning(false) }
  }, [refresh])

  return { rows, loading, scanning, error, scan, extract, refresh }
}
