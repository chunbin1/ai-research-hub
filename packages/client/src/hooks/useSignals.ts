import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { ScanSummary, SignalRow } from '../types'

export function useSignals() {
  const [rows, setRows] = useState<SignalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 扫一次数字变一次,给横幅和展开行的日志当作重新拉取的信号 —— 它们自己的
  // useEffect deps 看不到 rows 变化
  const [version, setVersion] = useState(0)
  const [lastScan, setLastScan] = useState<ScanSummary | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setRows(await api.listSignals())
      setVersion(v => v + 1)
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
      const summary = await api.scanSignals()
      setLastScan(summary)
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

  const setEnabled = useCallback(async (symbol: string, enabled: boolean) => {
    setError(null)
    try {
      await api.setWatchlistEnabled(symbol, enabled)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }, [refresh])

  return { rows, loading, scanning, error, scan, extract, refresh, version, lastScan, setEnabled }
}
