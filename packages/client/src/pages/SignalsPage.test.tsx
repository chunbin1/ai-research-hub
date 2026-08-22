import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

/** 与 ALB 同形,但翻转次数在阈值以下 —— 用来证明「震荡」是有条件的 */
const CALM = { ...ALB, symbol: 'CALM', name: 'Calm Corp', flips90d: 1 } as SignalRow

function stubRows(rows: SignalRow[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    // 按 URL 返回对应形状。一律返回 {rows} 会让横幅与展开行拿到 undefined ——
    // 那是 stub 在说谎,不该让生产代码加兜底去迁就它。
    // /api/auth/me 落进这个默认分支,拿到的是 {rows},没有 isAdmin 字段 ——
    // 等价于「未登录」,这个文件里默认场景的 admin 列因此不出现。
    const body = url.includes('/events') ? { events: [] }
      : url.includes('/log') ? { states: [] }
      : { rows }
    return { ok: true, json: async () => body } as Response
  }))
}

/** 与 stubRows 相同,但 /api/auth/me 显式返回一个 admin 用户 —— 用来测「启用」列 */
function stubRowsAsAdmin(rows: SignalRow[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = url.includes('/auth/me')
      ? { id: 'u1', username: 'admin', avatarUrl: null, messageCount: 0, limit: 100, unlimited: false, isAdmin: true, remaining: 100 }
      : url.includes('/events') ? { events: [] }
      : url.includes('/log') ? { states: [] }
      : { rows }
    return { ok: true, json: async () => body } as Response
  }))
}

const renderPage = () => render(<MemoryRouter><SignalsPage /></MemoryRouter>)

// useSignals 在每次成功 refresh 后(包括挂载时的首次自动 refresh)都会把 version
// 加一,这会让横幅再补拉一次 /events —— 如果这个补拉是在某条用例的断言已经满足、
// 但 afterEach 还没跑完之前才发出,它会用到已经被 unstubAllGlobals 撤掉的 fetch,
// 打到真实网络。让 unstub 晚一个宏任务,把这类还没来得及发出的请求让出窗口先发完。
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  vi.unstubAllGlobals()
})

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

test('近 90 天翻转过多时标出 whipsaw 警示,未超阈值的不标', async () => {
  // 阈值两侧都要有样本 —— 只放一个超阈值的行,「永远显示震荡」的回归也能蒙混过关
  stubRows([ALB, CALM])
  renderPage()
  await waitFor(() => expect(screen.getByText(/5 次 · 震荡/)).toBeTruthy())
  expect(screen.getByText('1 次')).toBeTruthy()
  expect(screen.queryAllByText(/震荡/)).toHaveLength(1)
})

test('异常标的显示错误信息,不显示信号', async () => {
  stubRows([BROKEN])
  renderPage()
  await waitFor(() => expect(screen.getByText(/代码不存在/)).toBeTruthy())
  // 90天翻转 也是信号列。显示「0 次」等于把「没数据」说成「确认没震荡」
  expect(screen.queryByText('0 次')).toBeNull()
})

test('空列表给出引导文案', async () => {
  stubRows([])
  renderPage()
  await waitFor(() => expect(screen.getByText(/还没有自选股/)).toBeTruthy())
})

test('未登录时看不到启用开关 —— 禁用是管理动作', async () => {
  stubRows([ALB])
  renderPage()
  await waitFor(() => expect(screen.getByText('ALB')).toBeTruthy())
  expect(screen.queryByRole('switch')).toBeNull()
})

test('admin 能看到启用开关', async () => {
  stubRowsAsAdmin([ALB])
  renderPage()
  await waitFor(() => expect(screen.getByText('ALB')).toBeTruthy())
  expect(screen.getByRole('switch', { name: 'ALB 启用' })).toBeTruthy()
})

test('被禁用的行整行置灰', async () => {
  stubRows([{ ...ALB, enabled: false }])
  const { container } = renderPage()
  await waitFor(() => expect(screen.getByText('ALB')).toBeTruthy())
  expect(container.querySelector('tr.opacity-50')).toBeTruthy()
})

test('扫描完成后页面显示本次扫描摘要', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/auth/me')) {
      return { ok: true, json: async () => ({ id: 'u1', username: 'admin', avatarUrl: null, messageCount: 0, limit: 100, unlimited: false, isAdmin: true, remaining: 100 }) } as Response
    }
    if (url.endsWith('/scan')) {
      return { ok: true, json: async () => ({ summary: { total: 4, ok: 4, failed: 0, insufficient: 0 } }) } as Response
    }
    if (url.includes('/events')) return { ok: true, json: async () => ({ events: [] }) } as Response
    if (url.includes('/log')) return { ok: true, json: async () => ({ states: [] }) } as Response
    return { ok: true, json: async () => ({ rows: [ALB] }) } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  renderPage()
  await waitFor(() => expect(screen.getByText('ALB')).toBeTruthy())
  await userEvent.click(screen.getByRole('button', { name: /立即扫描/ }))
  await waitFor(() => expect(screen.getByText(/扫描完成:共 4,成功 4,失败 0,数据不足 0/)).toBeTruthy())
  // 扫描成功会把 version 往上加一,横幅那边跟着再拉一次 /events —— 等这个也
  // 落地,不然它的 fetch 调用会晚于本用例的 afterEach(unstubAllGlobals) 才发出,
  // 打到没有 mock 的真实网络上
  await waitFor(() => expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/events')).length).toBeGreaterThanOrEqual(2))
})
