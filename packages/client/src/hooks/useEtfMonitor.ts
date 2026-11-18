import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addEtfUniverse,
  deleteEtfUniverse,
  fetchEtfBoard,
  fetchEtfTimeline,
  isEtfDisabledError,
  triggerEtfScan,
  updateEtfParams,
  updateEtfUniverse,
} from '../api'
import type {
  EtfBoardResponse,
  EtfDailySummary,
  EtfMonitorParams,
  EtfTier,
} from '../types'

export interface EtfScanResult {
  total: number
  ok: number
  failed: number
  latestDate: string | null
}

export function useEtfMonitor(initialDate?: string) {
  const [selectedDate, setSelectedDate] = useState<string | undefined>(initialDate)
  const [board, setBoard] = useState<EtfBoardResponse | null>(null)
  const [timeline, setTimeline] = useState<EtfDailySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [boardLoading, setBoardLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastScanResult, setLastScanResult] = useState<EtfScanResult | null>(null)

  const timelineLoadedRef = useRef(false)
  const requestSeqRef = useRef(0)
  const timelineSeqRef = useRef(0)
  // 始终追踪用户最新选中的日期，防止扫描等异步操作完成后被启动时的旧闭包日期覆盖
  const selectedDateRef = useRef<string | undefined>(selectedDate)
  selectedDateRef.current = selectedDate

  const loadBoard = useCallback(async (dateArg: string | undefined) => {
    const seq = ++requestSeqRef.current
    setError(null)
    setBoardLoading(true)
    try {
      const nextBoard = await fetchEtfBoard(dateArg)
      if (seq !== requestSeqRef.current) return
      setDisabled(false)
      setBoard(nextBoard)
    } catch (err) {
      if (seq !== requestSeqRef.current) return
      if (isEtfDisabledError(err)) {
        setDisabled(true)
      } else {
        setError(err instanceof Error ? err.message : 'ETF 托底看板加载失败')
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false)
        setBoardLoading(false)
      }
    }
  }, [])

  const loadTimeline = useCallback(async () => {
    const seq = ++timelineSeqRef.current
    try {
      const nextTimeline = await fetchEtfTimeline(90)
      if (seq !== timelineSeqRef.current) return
      setTimeline(nextTimeline)
      timelineLoadedRef.current = true
    } catch (err) {
      if (seq !== timelineSeqRef.current) return
      if (isEtfDisabledError(err)) {
        setDisabled(true)
      } else {
        setError(err instanceof Error ? err.message : '时间轴加载失败')
      }
    }
  }, [])

  const loadAll = useCallback(async (dateArg: string | undefined, includeTimeline: boolean) => {
    await Promise.all([
      loadBoard(dateArg),
      includeTimeline ? loadTimeline() : Promise.resolve(),
    ])
  }, [loadBoard, loadTimeline])

  useEffect(() => {
    const needTimeline = !timelineLoadedRef.current
    void loadAll(selectedDate, needTimeline)
  }, [selectedDate, loadAll])

  const selectDate = useCallback((date?: string) => {
    selectedDateRef.current = date
    setSelectedDate(date)
  }, [])

  const refresh = useCallback(async () => {
    await loadAll(selectedDateRef.current, true)
  }, [loadAll])

  const scan = useCallback(async (backfillDays?: number): Promise<string | null> => {
    setScanning(true)
    setError(null)
    try {
      const res = await triggerEtfScan(backfillDays)
      setLastScanResult(res)
      // 必须读取扫描结束时刻用户当前停留在的日期，避免切日后被扫描启动时的旧日期覆盖
      await loadAll(selectedDateRef.current, true)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ETF 扫描失败'
      setError(msg)
      return msg
    } finally {
      setScanning(false)
    }
  }, [loadAll])

  const addEtf = useCallback(async (code: string, tier: EtfTier): Promise<string | null> => {
    setError(null)
    try {
      await addEtfUniverse(code, tier)
      await loadAll(selectedDateRef.current, true)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加 ETF 失败'
      setError(msg)
      return msg
    }
  }, [loadAll])

  const updateEtf = useCallback(async (
    code: string,
    patch: { enabled?: boolean; tier?: EtfTier },
  ): Promise<string | null> => {
    setError(null)
    try {
      await updateEtfUniverse(code, patch)
      await loadAll(selectedDateRef.current, true)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新 ETF 失败'
      setError(msg)
      return msg
    }
  }, [loadAll])

  const deleteEtf = useCallback(async (code: string): Promise<string | null> => {
    setError(null)
    try {
      await deleteEtfUniverse(code)
      await loadAll(selectedDateRef.current, true)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除 ETF 失败'
      setError(msg)
      return msg
    }
  }, [loadAll])

  const saveParams = useCallback(async (patch: Partial<EtfMonitorParams>): Promise<string | null> => {
    setError(null)
    try {
      await updateEtfParams(patch)
      await loadAll(selectedDateRef.current, true)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新阈值参数失败'
      setError(msg)
      return msg
    }
  }, [loadAll])

  return {
    board,
    timeline,
    selectedDate,
    selectDate,
    loading,
    boardLoading,
    scanning,
    disabled,
    error,
    lastScanResult,
    refresh,
    scan,
    addEtf,
    updateEtf,
    deleteEtf,
    saveParams,
  }
}
