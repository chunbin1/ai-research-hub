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

  const loadAll = useCallback(async (dateArg: string | undefined, includeTimeline: boolean) => {
    const seq = ++requestSeqRef.current
    setError(null)
    setBoardLoading(true)
    try {
      const [nextBoard, nextTimeline] = await Promise.all([
        fetchEtfBoard(dateArg),
        includeTimeline ? fetchEtfTimeline(90) : Promise.resolve(null),
      ])
      if (seq !== requestSeqRef.current) return
      setDisabled(false)
      setBoard(nextBoard)
      if (nextTimeline !== null) {
        setTimeline(nextTimeline)
        timelineLoadedRef.current = true
      }
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

  useEffect(() => {
    const needTimeline = !timelineLoadedRef.current
    void loadAll(selectedDate, needTimeline)
  }, [selectedDate, loadAll])

  const selectDate = useCallback((date?: string) => {
    setSelectedDate(date)
  }, [])

  const refresh = useCallback(async () => {
    await loadAll(selectedDate, true)
  }, [loadAll, selectedDate])

  const scan = useCallback(async (backfillDays?: number): Promise<string | null> => {
    setScanning(true)
    setError(null)
    try {
      const res = await triggerEtfScan(backfillDays)
      setLastScanResult(res)
      // 扫描可能带来更新的交易日；若之前未指定日期，保持未指定从而自动落在最新日
      await loadAll(selectedDate, true)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ETF 扫描失败'
      setError(msg)
      return msg
    } finally {
      setScanning(false)
    }
  }, [loadAll, selectedDate])

  const addEtf = useCallback(async (code: string, tier: EtfTier): Promise<string | null> => {
    setError(null)
    try {
      await addEtfUniverse(code, tier)
      await loadAll(selectedDate, true)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加 ETF 失败'
      setError(msg)
      return msg
    }
  }, [loadAll, selectedDate])

  const updateEtf = useCallback(async (
    code: string,
    patch: { enabled?: boolean; tier?: EtfTier },
  ): Promise<string | null> => {
    setError(null)
    try {
      await updateEtfUniverse(code, patch)
      await loadAll(selectedDate, true)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新 ETF 失败'
      setError(msg)
      return msg
    }
  }, [loadAll, selectedDate])

  const deleteEtf = useCallback(async (code: string): Promise<string | null> => {
    setError(null)
    try {
      await deleteEtfUniverse(code)
      await loadAll(selectedDate, true)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除 ETF 失败'
      setError(msg)
      return msg
    }
  }, [loadAll, selectedDate])

  const saveParams = useCallback(async (patch: Partial<EtfMonitorParams>): Promise<string | null> => {
    setError(null)
    try {
      await updateEtfParams(patch)
      await loadAll(selectedDate, true)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新阈值参数失败'
      setError(msg)
      return msg
    }
  }, [loadAll, selectedDate])

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
