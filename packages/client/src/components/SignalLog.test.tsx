import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignalLog } from './SignalLog'
import { RecentSignalEvents } from './RecentSignalEvents'
import type { SignalStateRow, SignalEventRow } from '../types'

const daily: SignalStateRow[] = [
  { symbol: 'ALB', timeframe: '1d', bar_date: '2026-08-20', trend: 1, stop_line: 119.36, close_adj: 134.19, close_raw: 134.19, atr: 5.02 },
  { symbol: 'ALB', timeframe: '1d', bar_date: '2026-08-19', trend: 1, stop_line: 118.5, close_adj: 134.28, close_raw: 134.28, atr: 5.01 },
]
const weekly: SignalStateRow[] = [
  { symbol: 'ALB', timeframe: '1wk', bar_date: '2026-08-14', trend: -1, stop_line: 167.69, close_adj: 136.15, close_raw: 136.15, atr: 16.77 },
]

function stubFetch(impl: (url: string) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    ({ ok: true, json: async () => impl(url) }) as Response))
}

afterEach(() => { vi.unstubAllGlobals() })

test('展开后默认显示日线日志', async () => {
  stubFetch(url => ({ states: url.includes('1wk') ? weekly : daily }))
  render(<SignalLog symbol="ALB" />)
  await waitFor(() => expect(screen.getByText('2026-08-20')).toBeTruthy())
  expect(screen.getByText('2026-08-19')).toBeTruthy()
  expect(screen.getByText(/119\.36/)).toBeTruthy()
})

test('可以切到周线', async () => {
  stubFetch(url => ({ states: url.includes('1wk') ? weekly : daily }))
  render(<SignalLog symbol="ALB" />)
  await waitFor(() => expect(screen.getByText('2026-08-20')).toBeTruthy())

  // 点**可见的标签**而不是 getByRole('radio') 拿到的隐藏 input ——
  // antd 的 optionType="button" 给那个 input 加了 pointer-events:none,
  // user-event 会拒绝点击。点标签既能通过,也更贴近真人操作。
  await userEvent.click(screen.getByText('周线'))
  await waitFor(() => expect(screen.getByText('2026-08-14')).toBeTruthy())
  expect(screen.queryByText('2026-08-20')).toBeNull()
})

test('没有日志时给出空态', async () => {
  stubFetch(() => ({ states: [] }))
  render(<SignalLog symbol="NEW" />)
  await waitFor(() => expect(screen.getByText(/暂无日志/)).toBeTruthy())
})

const events: SignalEventRow[] = [
  { symbol: 'ALB', timeframe: '1d', bar_date: '2026-08-20', direction: 1, price: 134.19 },
  { symbol: '9696.HK', timeframe: '1wk', bar_date: '2026-08-18', direction: -1, price: 33.74 },
]

test('事件横幅列出最近信号', async () => {
  stubFetch(() => ({ events }))
  render(<RecentSignalEvents />)
  await waitFor(() => expect(screen.getByText(/ALB/)).toBeTruthy())
  expect(screen.getByText(/9696\.HK/)).toBeTruthy()
  expect(screen.getByText(/翻多/)).toBeTruthy()
  expect(screen.getByText(/翻空/)).toBeTruthy()
})

test('近 7 天没有事件时横幅整个不渲染', async () => {
  stubFetch(() => ({ events: [] }))
  const { container } = render(<RecentSignalEvents />)
  await waitFor(() => expect(container.textContent).toBe(''))
})
