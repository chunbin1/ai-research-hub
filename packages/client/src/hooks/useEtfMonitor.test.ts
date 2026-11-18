import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useEtfMonitor } from './useEtfMonitor'
import type { EtfBoardResponse, EtfDailySummary } from '../types'

function makeBoard(tradeDate: string): EtfBoardResponse {
  const summary: EtfDailySummary = {
    trade_date: tradeDate,
    resonance_level: 'none',
    active_count: 18,
    volume_spike_count: 0,
    support_etf_count: 0,
    support_tier_count: 0,
    total_amount_yi: 300,
    aggregate_vol_ratio: 1.0,
    total_net_inflow_yi: 0,
    data_stage: 'complete',
    updated_at: '2026-11-18T12:00:00Z',
  }
  return {
    summary,
    rows: [],
    disabledUniverse: [],
    params: { volRatioThreshold: 1.8, premiumThreshold: 0.05, inflowThresholdYi: 5.0 },
    lastScanAt: '2026-11-18T12:00:00Z',
    availableDates: ['2026-11-18', '2026-11-17'],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useEtfMonitor', () => {
  test('switching date while scan() is in flight refreshes the newly selected date instead of stale launch date', async () => {
    let resolveScan!: (res: Response) => void
    const boardRequests: string[] = []

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/etf/timeline')) {
        return { ok: true, json: async () => ({ days: [] }) } as Response
      }
      if (url.includes('/api/etf/scan') && init?.method === 'POST') {
        return new Promise<Response>(resolve => {
          resolveScan = resolve
        })
      }
      if (url.includes('/api/etf/board')) {
        boardRequests.push(url)
        const date = url.includes('date=2026-11-17') ? '2026-11-17' : '2026-11-18'
        return { ok: true, json: async () => makeBoard(date) } as Response
      }
      return { ok: false, json: async () => null } as Response
    }))

    const { result } = renderHook(() => useEtfMonitor())
    await waitFor(() => expect(result.current.board?.summary?.trade_date).toBe('2026-11-18'))

    // 1. 在最新日发起异步扫描（暂不 resolve）
    let scanPromise!: Promise<string | null>
    act(() => {
      scanPromise = result.current.scan()
    })

    // 2. 扫描等待期间切换到 2026-11-17
    act(() => {
      result.current.selectDate('2026-11-17')
    })
    await waitFor(() => expect(result.current.board?.summary?.trade_date).toBe('2026-11-17'))

    // 3. 扫描完成：应按当前选中的 2026-11-17 刷新，而不是覆盖回未传日期的 2026-11-18
    const countBeforeResolve = boardRequests.length
    await act(async () => {
      resolveScan({
        ok: true,
        json: async () => ({ summary: { total: 18, ok: 18, failed: 0, latestDate: '2026-11-18' } }),
      } as Response)
      await scanPromise
    })

    expect(boardRequests.slice(countBeforeResolve)).toEqual(['/api/etf/board?date=2026-11-17'])
    expect(result.current.selectedDate).toBe('2026-11-17')
    expect(result.current.board?.summary?.trade_date).toBe('2026-11-17')
  })
})
