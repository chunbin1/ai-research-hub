import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import HoldingsPage from './HoldingsPage'
import { formatMoney, formatPnl, formatShares, formatUpdatedAt, formatWeight } from '../lib/holdingsView'

const SNAP = {
  updatedAt: '2026-10-15T08:30:00.000Z',
  holdings: [
    { symbol: 'AAPL', name: 'Apple', shares: 10, marketValue: 2000, cost: 1500, pnl: 500, weight: 0.4 },
    { symbol: '0700.HK', name: null, shares: 100, marketValue: 3000, cost: 3500, pnl: -500, weight: 0.6 },
  ],
}

afterEach(() => { vi.unstubAllGlobals() })

function stubHoldings(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body }) as Response))
}

test('有持仓时表格展示字段,更新时间只有一处且在表上方', async () => {
  stubHoldings(SNAP)
  render(
    <MemoryRouter initialEntries={['/holdings']}>
      <Routes>
        <Route path="/" element={<p>研报列表</p>} />
        <Route path="/holdings" element={<HoldingsPage />} />
      </Routes>
    </MemoryRouter>,
  )

  const updated = await screen.findByText(`更新于 ${formatUpdatedAt(SNAP.updatedAt)}`)
  expect(updated.getAttribute('dateTime')).toBe(SNAP.updatedAt)
  expect(screen.getAllByText(/更新于/)).toHaveLength(1)

  const table = screen.getByRole('table')
  expect(updated.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: '标的' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: '股数' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: '市值' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: '成本' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: '浮动盈亏' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: '仓位占比' })).toBeTruthy()

  expect(screen.getByText('AAPL')).toBeTruthy()
  expect(screen.getByText('Apple')).toBeTruthy()
  expect(screen.getByText(formatShares(10))).toBeTruthy()
  expect(screen.getByText(formatMoney(2000))).toBeTruthy()
  expect(screen.getByText(formatMoney(1500))).toBeTruthy()
  expect(screen.getByText(formatWeight(0.4))).toBeTruthy()
  expect(screen.getByText(formatWeight(0.6))).toBeTruthy()

  const gain = screen.getByText(formatPnl(500))
  const loss = screen.getByText(formatPnl(-500))
  expect(gain.className).toContain('text-long')
  expect(loss.className).toContain('text-short')
  expect(screen.queryByText('研报列表')).toBeNull()
})

test('没有持仓时访问 /holdings 回到首页,不留空表', async () => {
  stubHoldings({ updatedAt: null, holdings: [] })
  render(
    <MemoryRouter initialEntries={['/holdings']}>
      <Routes>
        <Route path="/" element={<p>研报列表</p>} />
        <Route path="/holdings" element={<HoldingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByText('研报列表')).toBeTruthy())
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.queryByRole('heading', { name: '实盘持仓' })).toBeNull()
})
