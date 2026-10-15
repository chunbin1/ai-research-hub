import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SiteHeader } from './SiteHeader'
import { HoldingsProvider } from '../hooks/useHoldings'

afterEach(() => { vi.unstubAllGlobals() })

function stub(holdingsBody: unknown, holdingsOk = true) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/holdings')) {
      return { ok: holdingsOk, json: async () => holdingsBody } as Response
    }
    return { ok: false, json: async () => null } as Response
  }))
}

function renderHeader(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HoldingsProvider>
        <SiteHeader />
      </HoldingsProvider>
    </MemoryRouter>,
  )
}

test('没有持仓时导航不出现「持仓」,信号入口还在', async () => {
  stub({ updatedAt: null, holdings: [] })
  renderHeader()
  await waitFor(() => {
    expect(vi.mocked(fetch).mock.calls.some(call => String(call[0]).includes('/api/holdings'))).toBe(true)
  })
  expect(screen.queryAllByRole('link', { name: '持仓' })).toHaveLength(0)
  expect(screen.getAllByRole('link', { name: '信号' }).length).toBeGreaterThan(0)
})

test('持仓接口失败时也不显示入口', async () => {
  stub(null, false)
  renderHeader()
  await waitFor(() => {
    expect(vi.mocked(fetch).mock.calls.some(call => String(call[0]).includes('/api/holdings'))).toBe(true)
  })
  expect(screen.queryAllByRole('link', { name: '持仓' })).toHaveLength(0)
})

test('有持仓时桌面和移动导航都出现「持仓」', async () => {
  stub({
    updatedAt: '2026-10-15T08:30:00.000Z',
    holdings: [{ symbol: 'AAPL', name: 'Apple', shares: 1, marketValue: 1, cost: 1, pnl: 0, weight: 1 }],
  })
  renderHeader('/holdings')
  await waitFor(() => expect(screen.getAllByRole('link', { name: '持仓' })).toHaveLength(2))
  for (const link of screen.getAllByRole('link', { name: '持仓' })) {
    expect(link.getAttribute('href')).toBe('/holdings')
    expect(link.getAttribute('aria-current')).toBe('page')
  }
})
