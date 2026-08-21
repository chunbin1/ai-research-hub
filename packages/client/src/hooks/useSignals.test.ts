import { test, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSignals } from './useSignals'
import type { SignalRow } from '../types'

const ALB = {
  symbol: 'ALB', name: 'Albemarle Corporation', market: 'US', currency: 'USD', closeRaw: 134.19,
  daily: { trend: 1, barDate: '2026-08-20', stopLine: 119.36, closeAdj: 134.19, atr: 5.02, distPct: 12.4, flipDate: '2026-08-07', flipPrice: 131.11, heldDays: 13, sinceFlipPct: 2.3 },
  weekly: { trend: -1, barDate: '2026-08-14', stopLine: 167.69, closeAdj: 136.15, atr: 16.77, distPct: -18.8, flipDate: '2026-06-26', flipPrice: 133.7, heldDays: 49, sinceFlipPct: 1.8 },
  divergent: true, flips90d: 2, sourceDoc: { id: 'doc_1', filename: '碳酸锂产业链投资研究报告' },
  sourceText: '5.5 Albemarle（NYSE: ALB）', enabled: true, status: 'ok', lastError: null,
  lastScanAt: '2026-08-21T00:00:00.000Z',
} as SignalRow

function stubFetch(impl: (url: string, init?: RequestInit) => { ok?: boolean; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const { ok = true, body } = impl(url, init)
    return { ok, json: async () => body } as Response
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

test('挂载后拉看板数据', async () => {
  stubFetch(() => ({ body: { rows: [ALB] } }))
  const { result } = renderHook(() => useSignals())
  expect(result.current.loading).toBe(true)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.rows).toHaveLength(1)
  expect(result.current.rows[0].symbol).toBe('ALB')
  expect(result.current.error).toBeNull()
})

test('请求失败时记录错误,rows 保持空数组', async () => {
  stubFetch(() => ({ ok: false, body: { error: 'boom', message: '看板加载失败' } }))
  const { result } = renderHook(() => useSignals())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBe('看板加载失败')
  expect(result.current.rows).toEqual([])
})

test('scan 期间 scanning 为 true,结束后自动刷新', async () => {
  // 必须观察到**中途**的 true —— 只断言结束态的话,把 scanning 整个删掉测试照样绿,
  // 而它存在的唯一理由就是驱动按钮的 loading 态。所以用一个闸门把 /scan 卡住。
  let scanned = false
  let releaseScan!: () => void
  const scanGate = new Promise<void>(resolve => { releaseScan = resolve })

  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/scan')) {
      await scanGate
      scanned = true
      return { ok: true, json: async () => ({ summary: { total: 1, ok: 1, failed: 0, insufficient: 0 } }) } as Response
    }
    return { ok: true, json: async () => ({ rows: scanned ? [ALB, { ...ALB, symbol: 'SQM' }] : [ALB] }) } as Response
  }))

  const { result } = renderHook(() => useSignals())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.rows).toHaveLength(1)
  expect(result.current.scanning).toBe(false)

  let pending!: Promise<void>
  act(() => { pending = result.current.scan() })
  await waitFor(() => expect(result.current.scanning).toBe(true))   // 中途态

  releaseScan()
  await act(async () => { await pending })
  await waitFor(() => expect(result.current.rows).toHaveLength(2))
  expect(result.current.scanning).toBe(false)
})

test('extract 结束后也刷新', async () => {
  let extracted = false
  stubFetch((url) => {
    if (url.endsWith('/extract')) { extracted = true; return { body: { documents: 1, symbols: ['ALB'] } } }
    return { body: { rows: extracted ? [ALB] : [] } }
  })
  const { result } = renderHook(() => useSignals())
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { await result.current.extract() })
  await waitFor(() => expect(result.current.rows).toHaveLength(1))
})
