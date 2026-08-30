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
    // /api/auth/me 单独给 401:顶栏要按 user 画头像和用户名,拿一个没有 username
    // 的对象冒充「未登录」就是在说谎(改版前信号页没有顶栏,才一直没暴露)。
    if (url.includes('/auth/me')) return { ok: false, json: async () => null } as Response
    const body = url.includes('/events') ? { events: [] }
      : url.includes('/log') ? { states: [] }
      : { rows }
    return { ok: true, json: async () => body } as Response
  }))
}

/** 与 stubRows 相同,但 /api/auth/me 显式返回一个 admin 用户 —— 用来测操作列与添加标的 */
function stubRowsAsAdmin(rows: SignalRow[], onDelete?: () => void) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') { onDelete?.(); return { ok: true, json: async () => ({ ok: true }) } as Response }
    const body = url.includes('/auth/me')
      ? { id: 'u1', username: 'admin', avatarUrl: null, messageCount: 0, limit: 100, unlimited: false, isAdmin: true, remaining: 100 }
      : url.includes('/events') ? { events: [] }
      : url.includes('/log') ? { states: [] }
      : { rows }
    return { ok: true, json: async () => body } as Response
  }))
}

const renderPage = () => render(<MemoryRouter><SignalsPage /></MemoryRouter>)

afterEach(() => { vi.unstubAllGlobals() })

test('渲染标的、现价与日周趋势', async () => {
  stubRows([ALB])
  renderPage()
  await waitFor(() => expect(screen.getByText('ALB')).toBeTruthy())
  expect(screen.getByText('Albemarle Corporation')).toBeTruthy()
  expect(screen.getByText(/134\.19/)).toBeTruthy()
  // 翻转日期与所在周期的最新 bar 同年,按设计稿省去年份
  expect(screen.getByText(/08-07 起 13 天/)).toBeTruthy()
  expect(screen.getByText(/06-26 起 49 天/)).toBeTruthy()
})

test('挂载只拉一次 /events —— version 不应该在首次 refresh 后又自增一次', async () => {
  // 回归用例:version 曾经在 refresh() 内部自增,而挂载时的首次 refresh 也走
  // 这条路,导致横幅在挂载阶段就多打一次 /events。version 现在只在
  // scan/extract/setEnabled 成功后才自增,挂载本身不应该触发第二次请求。
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/auth/me')) return { ok: false, json: async () => null } as Response
    const body = url.includes('/events') ? { events: [] }
      : url.includes('/log') ? { states: [] }
      : { rows: [ALB] }
    return { ok: true, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  renderPage()
  await waitFor(() => expect(screen.getByText('ALB')).toBeTruthy())
  // 给任何多余的补拉留出机会真的发出来,而不是靠时间点侥幸躲过断言
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/events')).length).toBe(1)
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
  // 行上只留「震荡」这个例外标记,具体次数收进展开区(设计稿的表格没有这一列)
  await waitFor(() => expect(screen.getAllByText('震荡')).toHaveLength(1))
  expect(screen.getByTitle('近 90 天翻转 5 次')).toBeTruthy()

  await userEvent.click(screen.getByRole('button', { name: /展开 CALM/ }))
  expect(await screen.findByText(/近 90 天翻转 1 次/)).toBeTruthy()
  expect(screen.queryByText(/近 90 天翻转 1 次 · 震荡/)).toBeNull()
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

test('非管理员看不到添加按钮,展开区里也没有删除', async () => {
  stubRows([ALB])
  renderPage()
  await waitFor(() => expect(screen.getByText('ALB')).toBeTruthy())
  expect(screen.queryByRole('button', { name: /添加标的/ })).toBeNull()

  await userEvent.click(screen.getByRole('button', { name: /展开 ALB/ }))
  await screen.findByText(/来源/)
  expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
})

test('管理员看得到「添加标的」,删除在展开区里', async () => {
  stubRowsAsAdmin([ALB])
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /添加标的/ })).toBeTruthy())
  // 删除是低频的管理动作,设计稿的七列里没有它的位置 —— 收进展开区
  expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /展开 ALB/ }))
  expect(await screen.findByRole('button', { name: /删除/ })).toBeTruthy()
})

test('删除要二次确认,确认后才发请求', async () => {
  let deleted = false
  stubRowsAsAdmin([ALB], () => { deleted = true })
  renderPage()
  await waitFor(() => expect(screen.getByText('ALB')).toBeTruthy())
  await userEvent.click(screen.getByRole('button', { name: /展开 ALB/ }))

  await userEvent.click(await screen.findByRole('button', { name: /删除/ }))
  expect(deleted).toBe(false)   // 只是弹出确认,还没删

  await waitFor(() => expect(screen.getByText(/确定删除/)).toBeTruthy())
  await userEvent.click(screen.getByRole('button', { name: '确定' }))
  await waitFor(() => expect(deleted).toBe(true))
})

test('点「添加标的」弹出弹窗', async () => {
  stubRowsAsAdmin([ALB])
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /添加标的/ })).toBeTruthy())
  await userEvent.click(screen.getByRole('button', { name: /添加标的/ }))
  await waitFor(() => expect(screen.getByLabelText('代码')).toBeTruthy())
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
})
