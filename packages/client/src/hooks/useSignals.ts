import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { ScanSummary, SignalRow } from '../types'

export function useSignals() {
  const [rows, setRows] = useState<SignalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 语义是「一次动作(扫描/抽取/添加/删除)改了数据」,不是「刷新过了」——
  // 挂载时的首次 refresh 已经覆盖了首屏加载,不需要再触发横幅/日志重拉一次;
  // 只有 scan/extract/add/remove 成功后才自增,给横幅和展开行的日志当作
  // 重新拉取的信号(它们自己的 useEffect deps 看不到 rows 变化)
  const [version, setVersion] = useState(0)
  const [lastScan, setLastScan] = useState<ScanSummary | null>(null)

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
      const summary = await api.scanSignals()
      setLastScan(summary)
      await refresh()
      setVersion(v => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败')
    } finally { setScanning(false) }
  }, [refresh])

  const extract = useCallback(async () => {
    setScanning(true); setError(null)
    try {
      await api.extractWatchlist()
      await refresh()
      setVersion(v => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : '抽取失败')
    } finally { setScanning(false) }
  }, [refresh])

  const add = useCallback(async (symbol: string, market: 'US' | 'HK') => {
    setError(null)
    try {
      await api.addSymbol(symbol, market)
      await refresh()
      setVersion(v => v + 1)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败')
      return false
    }
  }, [refresh])

  const remove = useCallback(async (symbol: string) => {
    setError(null)
    try {
      await api.deleteSymbol(symbol)
      await refresh()
      setVersion(v => v + 1)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
      return false
    }
  }, [refresh])

  return { rows, loading, scanning, error, scan, extract, refresh, version, lastScan, add, remove }
}
