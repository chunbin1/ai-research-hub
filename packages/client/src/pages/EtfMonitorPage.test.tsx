import { afterEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import EtfMonitorPage from './EtfMonitorPage'
import type {
  EtfBoardResponse,
  EtfBoardRow,
  EtfDailyMetric,
  EtfDailySummary,
  EtfTier,
  EtfUniverseEntry,
} from '../types'

const PRESET_SPEC: Array<{ code: string; name: string; tier: EtfTier; market: 'SH' | 'SZ' }> = [
  { code: '510050', name: '上证50ETF华夏', tier: 'mega', market: 'SH' },
  { code: '510300', name: '沪深300ETF华泰柏瑞', tier: 'mega', market: 'SH' },
  { code: '510310', name: '沪深300ETF易方达', tier: 'mega', market: 'SH' },
  { code: '510330', name: '沪深300ETF华夏', tier: 'mega', market: 'SH' },
  { code: '159919', name: '沪深300ETF嘉实', tier: 'mega', market: 'SZ' },
  { code: '512050', name: 'A500ETF华夏', tier: 'mega', market: 'SH' },
  { code: '510500', name: '中证500ETF南方', tier: 'mid', market: 'SH' },
  { code: '512500', name: '中证500ETF华夏', tier: 'mid', market: 'SH' },
  { code: '512100', name: '中证1000ETF南方', tier: 'small', market: 'SH' },
  { code: '159845', name: '中证1000ETF华夏', tier: 'small', market: 'SZ' },
  { code: '560010', name: '中证1000ETF广发', tier: 'small', market: 'SH' },
  { code: '159629', name: '中证1000ETF富国', tier: 'small', market: 'SZ' },
  { code: '563300', name: '中证2000ETF华泰柏瑞', tier: 'small', market: 'SH' },
  { code: '159915', name: '创业板ETF易方达', tier: 'growth', market: 'SZ' },
  { code: '159952', name: '创业板ETF广发', tier: 'growth', market: 'SZ' },
  { code: '159977', name: '创业板ETF天弘', tier: 'growth', market: 'SZ' },
  { code: '588000', name: '科创50ETF华夏', tier: 'growth', market: 'SH' },
  { code: '588080', name: '科创50ETF易方达', tier: 'growth', market: 'SH' },
]

function makeMetric(code: string, tradeDate = '2026-11-18', over: Partial<EtfDailyMetric> = {}): EtfDailyMetric {
  return {
    code,
    trade_date: tradeDate,
    open: 3.9,
    close: 3.95,
    pct_change: 0.85,
    volume: 1000000,
    amount: 25_0000_0000,
    vol_ratio_5: 1.2,
    vol_ratio_20: 1.1,
    nav: 3.94,
    nav_source: 'official',
    premium_rate: 0.02,
    total_shares: 100_0000_0000,
    share_source: 'sse_history',
    share_delta: 0,
    net_inflow_yi: 0.5,
    signal_level: 'normal',
    updated_at: '2026-11-18T12:00:00Z',
    ...over,
  }
}

function makeRows(tradeDate = '2026-11-18'): EtfBoardRow[] {
  return PRESET_SPEC.map((s, idx) => {
    let metric = makeMetric(s.code, tradeDate)
    if (s.code === '510310') {
      metric = makeMetric(s.code, tradeDate, {
        vol_ratio_20: 2.85,
        premium_rate: 0.12,
        net_inflow_yi: 19.4,
        signal_level: 'strong_support',
      })
    } else if (s.code === '159952') {
      metric = makeMetric(s.code, tradeDate, {
        vol_ratio_20: 2.4,
        nav_source: 'iopv',
        premium_rate: -0.07,
        net_inflow_yi: null,
        signal_level: 'volume_only',
      })
    }
    return {
      code: s.code,
      market: s.market,
      name: s.name,
      tier: s.tier,
      enabled: true,
      sort_order: (idx + 1) * 10,
      created_at: '2026-11-18T00:00:00Z',
      metric,
      perf: s.code === '510310'
        ? { return_5d: 2.34, return_10d: -1.12, return_since: tradeDate === '2026-11-17' ? 3.45 : null }
        : { return_5d: 0.5, return_10d: 1.0, return_since: null },
    }
  })
}

function makeSummary(over: Partial<EtfDailySummary> = {}): EtfDailySummary {
  return {
    trade_date: '2026-11-18',
    resonance_level: 'strong',
    active_count: 18,
    volume_spike_count: 4,
    support_etf_count: 5,
    support_tier_count: 3,
    total_amount_yi: 486.2,
    aggregate_vol_ratio: 1.92,
    total_net_inflow_yi: 115.6,
    data_stage: 'complete',
    updated_at: '2026-11-18T12:00:00Z',
    ...over,
  }
}

function makeBoard(over: Partial<EtfBoardResponse> = {}): EtfBoardResponse {
  return {
    summary: makeSummary(),
    rows: makeRows(),
    disabledUniverse: [
      {
        code: '510880',
        market: 'SH',
        name: '红利ETF',
        tier: 'mega',
        enabled: false,
        sort_order: 190,
        created_at: '2026-11-18T00:00:00Z',
      },
    ],
    params: { volRatioThreshold: 1.8, premiumThreshold: 0.05, inflowThresholdYi: 5.0 },
    lastScanAt: '2026-11-18T12:00:00Z',
    availableDates: ['2026-11-18', '2026-11-17'],
    ...over,
  }
}

function makeTimeline(): EtfDailySummary[] {
  return [
    makeSummary({
      trade_date: '2026-11-17',
      resonance_level: 'strong',
      support_etf_count: 6,
      support_tier_count: 3,
      total_amount_yi: 512.0,
      total_net_inflow_yi: 118.4,
      data_stage: 'complete',
    }),
    makeSummary({
      trade_date: '2026-11-18',
      resonance_level: 'watch',
      support_etf_count: 2,
      support_tier_count: 1,
      total_amount_yi: 320.5,
      total_net_inflow_yi: 12.1,
      data_stage: 'nav_ready',
    }),
  ]
}

const renderPage = () => render(<MemoryRouter><EtfMonitorPage /></MemoryRouter>)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EtfMonitorPage', () => {
  test('renders overview card, timeline bars, 18 ETFs and IOPV estimate badge', async () => {
    const board = makeBoard({
      summary: makeSummary({ data_stage: 'nav_ready', resonance_level: 'strong' }),
    })
    const timeline = makeTimeline()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: false, json: async () => null } as Response
      if (url.includes('/api/etf/timeline')) return { ok: true, json: async () => ({ days: timeline }) } as Response
      if (url.includes('/api/etf/board')) return { ok: true, json: async () => board } as Response
      return { ok: false, json: async () => null } as Response
    }))

    renderPage()

    await waitFor(() => expect(screen.getByText('510310')).toBeTruthy())
    expect(screen.getAllByText('强托底共振').length).toBeGreaterThan(0)
    expect(screen.getByText('5 / 18 只')).toBeTruthy()
    expect(screen.getByText('3 / 4 个梯队')).toBeTruthy()
    expect(screen.getByText('486.2亿')).toBeTruthy()
    expect(screen.getByText('+115.6亿')).toBeTruthy()
    expect(screen.getByText('含官方净值')).toBeTruthy()

    // 所有 18 只 ETF 代码均展示，包含 159952 与 IOPV 估算标记
    for (const s of PRESET_SPEC) {
      expect(screen.getByText(s.code)).toBeTruthy()
    }
    expect(screen.getAllByText('IOPV').length).toBeGreaterThan(0)

    // 历史时间轴竖条渲染
    expect(screen.getByRole('button', { name: /2026-11-17/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /2026-11-18/ })).toBeTruthy()
  })

  test('clicking a timeline date triggers /api/etf/board?date=YYYY-MM-DD', async () => {
    const board18 = makeBoard({ summary: makeSummary({ trade_date: '2026-11-18' }) })
    const board17 = makeBoard({
      summary: makeSummary({ trade_date: '2026-11-17', total_net_inflow_yi: 222.5 }),
      rows: makeRows('2026-11-17'),
    })
    const timeline = makeTimeline()

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: false, json: async () => null } as Response
      if (url.includes('/api/etf/timeline')) return { ok: true, json: async () => ({ days: timeline }) } as Response
      if (url.includes('/api/etf/board?date=2026-11-17')) {
        return { ok: true, json: async () => board17 } as Response
      }
      if (url.includes('/api/etf/board')) return { ok: true, json: async () => board18 } as Response
      return { ok: false, json: async () => null } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await waitFor(() => expect(screen.getByText('+115.6亿')).toBeTruthy())

    await userEvent.click(screen.getByRole('button', { name: /2026-11-17/ }))
    await waitFor(() => expect(screen.getByText('+222.5亿')).toBeTruthy())
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/api/etf/board?date=2026-11-17'))).toBe(true)
  })

  test('filters active anomalies and expands row to load 15-day history', async () => {
    const board = makeBoard()
    const timeline = makeTimeline()
    const history510310: EtfDailyMetric[] = [
      makeMetric('510310', '2026-11-18', { vol_ratio_20: 2.85, premium_rate: 0.12, net_inflow_yi: 19.4, signal_level: 'strong_support' }),
      makeMetric('510310', '2026-11-17', { vol_ratio_20: 2.15, premium_rate: 0.08, net_inflow_yi: 11.2, signal_level: 'strong_support' }),
    ]

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: false, json: async () => null } as Response
      if (url.includes('/api/etf/timeline')) return { ok: true, json: async () => ({ days: timeline }) } as Response
      if (url.includes('/api/etf/510310/history')) {
        return {
          ok: true,
          json: async () => ({
            code: '510310',
            entry: board.rows.find(r => r.code === '510310') as EtfUniverseEntry,
            history: history510310,
          }),
        } as Response
      }
      if (url.includes('/api/etf/board')) return { ok: true, json: async () => board } as Response
      return { ok: false, json: async () => null } as Response
    }))

    renderPage()
    await waitFor(() => expect(screen.getByText('510050')).toBeTruthy())

    // 点击「仅看异动」后，常规行 510050 隐藏，异动行 510310 / 159952 保留
    await userEvent.click(screen.getByRole('button', { name: /仅看异动/ }))
    await waitFor(() => expect(screen.queryByText('510050')).toBeNull())
    expect(screen.getByText('510310')).toBeTruthy()
    expect(screen.getByText('159952')).toBeTruthy()

    // 展开 510310 查看近 15 日走势
    await userEvent.click(screen.getByRole('button', { name: /展开 510310/ }))
    await waitFor(() => expect(screen.getByText('+11.2亿')).toBeTruthy())
    expect(screen.getAllByText('+19.4亿').length).toBeGreaterThanOrEqual(2)
  })

  test('admin controls are visible only to admin and disabled ETFs can be restored', async () => {
    const board = makeBoard()
    const timeline = makeTimeline()
    let restored = false

    const makeFetch = (isAdmin: boolean) => vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/me')) {
        return isAdmin
          ? { ok: true, json: async () => ({ id: 'u1', username: 'admin', avatarUrl: null, messageCount: 0, limit: 100, unlimited: false, isAdmin: true, remaining: 100 }) } as Response
          : { ok: false, json: async () => null } as Response
      }
      if (url.includes('/api/etf/timeline')) return { ok: true, json: async () => ({ days: timeline }) } as Response
      if (url.includes('/api/etf/universe/510880') && init?.method === 'PATCH') {
        restored = true
        return { ok: true, json: async () => ({ entry: { ...board.disabledUniverse[0], enabled: true } }) } as Response
      }
      if (url.includes('/api/etf/board')) return { ok: true, json: async () => board } as Response
      return { ok: false, json: async () => null } as Response
    })

    // 游客视角
    vi.stubGlobal('fetch', makeFetch(false))
    const { unmount } = renderPage()
    await waitFor(() => expect(screen.getByText('510310')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /立即扫描/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /参数设置/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /管理标的/ })).toBeNull()
    unmount()

    // 管理员视角
    vi.stubGlobal('fetch', makeFetch(true))
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /立即扫描/ })).toBeTruthy())
    expect(screen.getByRole('button', { name: /参数设置/ })).toBeTruthy()
    const manageBtn = screen.getByRole('button', { name: /管理标的/ })
    expect(manageBtn).toBeTruthy()

    await userEvent.click(manageBtn)
    await waitFor(() => expect(screen.getByText(/红利ETF/)).toBeTruthy())
    const restoreBtn = screen.getByRole('button', { name: /恢复启用/ })
    await userEvent.click(restoreBtn)
    await waitFor(() => expect(restored).toBe(true))
  })

  test('renders disabled state cleanly on 404 etf_monitor_disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: false, json: async () => null } as Response
      if (url.includes('/api/etf/')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'etf_monitor_disabled' }),
        } as Response
      }
      return { ok: false, json: async () => null } as Response
    }))

    renderPage()
    await waitFor(() => expect(screen.getByText('ETF 托底监控未启用')).toBeTruthy())
  })

  test('table volume threshold uses board.params.volRatioThreshold and expanded history refreshes after saving params', async () => {
    let currentThreshold = 3.0
    let currentLevel: 'normal' | 'strong_support' = 'normal'
    let historyCalls = 0

    const timeline = makeTimeline()
    const buildBoard = () => {
      const board = makeBoard({
        params: { volRatioThreshold: currentThreshold, premiumThreshold: 0.05, inflowThresholdYi: 5.0 },
      })
      board.rows = board.rows.map(r => r.code === '510310'
        ? { ...r, metric: makeMetric('510310', '2026-11-18', { vol_ratio_20: 2.85, signal_level: currentLevel }) }
        : r)
      return board
    }

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/me')) {
        return {
          ok: true,
          json: async () => ({ id: 'u1', username: 'admin', avatarUrl: null, messageCount: 0, limit: 100, unlimited: false, isAdmin: true, remaining: 100 }),
        } as Response
      }
      if (url.includes('/api/etf/timeline')) return { ok: true, json: async () => ({ days: timeline }) } as Response
      if (url.includes('/api/etf/510310/history')) {
        historyCalls++
        return {
          ok: true,
          json: async () => ({
            code: '510310',
            entry: buildBoard().rows.find(r => r.code === '510310') as EtfUniverseEntry,
            history: [makeMetric('510310', '2026-11-18', { vol_ratio_20: 2.85, signal_level: currentLevel })],
          }),
        } as Response
      }
      if (url.includes('/api/etf/params') && init?.method === 'PATCH') {
        currentThreshold = 2.0
        currentLevel = 'strong_support'
        return { ok: true, json: async () => ({ params: { volRatioThreshold: 2.0, premiumThreshold: 0.05, inflowThresholdYi: 5.0 } }) } as Response
      }
      if (url.includes('/api/etf/board')) return { ok: true, json: async () => buildBoard() } as Response
      return { ok: false, json: async () => null } as Response
    }))

    renderPage()
    await waitFor(() => expect(screen.getByText('2.85x')).toBeTruthy())
    // 阈值 3.0 时，2.85x 不应标红为 text-long
    expect(screen.getByText('2.85x').className).not.toContain('text-long')

    // 展开 510310
    await userEvent.click(screen.getByRole('button', { name: /展开 510310/ }))
    await waitFor(() => expect(historyCalls).toBe(1))

    // 修改阈值为 2.0 并保存：2.85x 应转为 text-long，且已展开明细应自动重拉历史
    await userEvent.click(screen.getByRole('button', { name: /参数设置/ }))
    const volInput = await screen.findByLabelText(/20 日放量倍数阈值/)
    await userEvent.clear(volInput)
    await userEvent.type(volInput, '2')
    await userEvent.click(screen.getByRole('button', { name: '保存并重算' }))

    await waitFor(() => expect(screen.getAllByText('2.85x')[0].className).toContain('text-long'))
    await waitFor(() => expect(historyCalls).toBe(2))
  })

  test('displays market cap, turnover rate, multi-day returns and opens calendar popover to switch date', async () => {
    const board18 = makeBoard({ summary: makeSummary({ trade_date: '2026-11-18' }) })
    const board17 = makeBoard({
      summary: makeSummary({ trade_date: '2026-11-17', total_net_inflow_yi: 222.5 }),
      rows: makeRows('2026-11-17'),
    })
    const timeline = makeTimeline()

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: false, json: async () => null } as Response
      if (url.includes('/api/etf/timeline')) return { ok: true, json: async () => ({ days: timeline }) } as Response
      if (url.includes('/api/etf/board?date=2026-11-17')) return { ok: true, json: async () => board17 } as Response
      if (url.includes('/api/etf/board')) return { ok: true, json: async () => board18 } as Response
      return { ok: false, json: async () => null } as Response
    }))

    renderPage()
    // 规模 = 100亿份 * 3.94 = 394.0亿，成交额 25亿 -> 换手率约 6.35%
    await waitFor(() => expect(screen.getAllByText('394.0亿').length).toBeGreaterThan(0))
    expect(screen.getAllByText(/换手 6\.35%/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '市值' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '5日' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '10日' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '距今' })).toBeTruthy()
    expect(screen.getByText('+2.34%')).toBeTruthy()
    expect(screen.getByText('-1.12%')).toBeTruthy()

    // 打开日历选择器点击 2026-11-17 后应展示 距今 +3.45%
    await userEvent.click(screen.getByRole('button', { name: '选择历史交易日' }))
    expect(screen.getByRole('dialog', { name: '交易日历' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '2026-11-17' }))
    await waitFor(() => expect(screen.getByText('+3.45%')).toBeTruthy())
  })
})
