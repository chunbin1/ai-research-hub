import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SignalsPage from './SignalsPage'
import type { SignalRow } from '../types'

const ALB = {
  symbol: 'ALB', name: 'Albemarle Corporation', market: 'US', currency: 'USD', closeRaw: 134.19,
  daily: { trend: 1, barDate: '2026-08-20', stopLine: 119.36, closeAdj: 134.19, atr: 5.02, distPct: 12.4, flipDate: '2026-08-07', flipPrice: 131.11, heldDays: 13, sinceFlipPct: 2.3 },
  weekly: { trend: -1, barDate: '2026-08-14', stopLine: 167.69, closeAdj: 136.15, atr: 16.77, distPct: -18.8, flipDate: '2026-06-26', flipPrice: 133.7, heldDays: 49, sinceFlipPct: 1.8 },
  divergent: true, flips90d: 5, sourceDoc: { id: 'doc_1', filename: '碳酸锂产业链投资研究报告' },
  sourceText: '5.5 Albemarle（NYSE: ALB）', enabled: true, status: 'ok', lastError: null,
  lastScanAt: '2026-08-21T00:00:00.000Z',
} as SignalRow

const BROKEN = {
  ...ALB, symbol: 'NOPE', name: null, closeRaw: null, daily: null, weekly: null,
  divergent: false, flips90d: 0, status: 'invalid', lastError: 'NOPE: 代码不存在',
} as SignalRow

function stubRows(rows: SignalRow[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ rows }) }) as Response))
}

const renderPage = () => render(<MemoryRouter><SignalsPage /></MemoryRouter>)

afterEach(() => { vi.unstubAllGlobals() })

test('渲染标的、现价与日周趋势', async () => {
  stubRows([ALB])
  renderPage()
  await waitFor(() => expect(screen.getByText('ALB')).toBeTruthy())
  expect(screen.getByText('Albemarle Corporation')).toBeTruthy()
  expect(screen.getByText(/134\.19/)).toBeTruthy()
  expect(screen.getByText(/2026-08-07/)).toBeTruthy()
  expect(screen.getByText(/2026-06-26/)).toBeTruthy()
})

test('日周背离时给出提示', async () => {
  stubRows([ALB])
  renderPage()
  await waitFor(() => expect(screen.getByText(/背离/)).toBeTruthy())
})

test('近 90 天翻转过多时标出 whipsaw 警示', async () => {
  stubRows([ALB])
  renderPage()
  // flips90d = 5,应带上警示文案
  await waitFor(() => expect(screen.getByText(/震荡/)).toBeTruthy())
})

test('异常标的显示错误信息,不显示信号', async () => {
  stubRows([BROKEN])
  renderPage()
  await waitFor(() => expect(screen.getByText(/代码不存在/)).toBeTruthy())
})

test('空列表给出引导文案', async () => {
  stubRows([])
  renderPage()
  await waitFor(() => expect(screen.getByText(/还没有自选股/)).toBeTruthy())
})
