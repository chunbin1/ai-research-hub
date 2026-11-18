import { StrictMode } from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import WhalesPage from './WhalesPage'
import WhaleDetailPage from './WhaleDetailPage'
import { SiteHeader } from '../components/SiteHeader'
import { HoldingsProvider } from '../hooks/useHoldings'
import { changeLabel, formatShareDelta, formatUsd } from '../lib/whaleView'

afterEach(() => {
  document.body.style.overflow = ''
  vi.unstubAllGlobals()
})

const LIST = {
  valueNote: '市值为美元。',
  institutions: [
    {
      slug: 'berkshire',
      manager: '巴菲特',
      nameZh: '伯克希尔·哈撒韦',
      nameEn: 'Berkshire Hathaway Inc',
      cik: '0001067983',
      dataStatus: 'ready',
      syncError: null,
      latest: {
        reportPeriod: '2026-06-30',
        filedAt: '2026-08-14',
        form: '13F-HR',
        positionCount: 2,
        totalValueUsd: 2500,
        top: { issuerName: 'APPLE INC', ticker: 'AAPL', cusip: '037833100' },
      },
    },
    {
      slug: 'scion',
      manager: '迈克尔·伯里',
      nameZh: 'Scion',
      nameEn: 'Scion Asset Management, LLC',
      cik: '0001649339',
      dataStatus: 'empty',
      syncError: 'SEC 503',
      latest: null,
    },
  ],
}

const DETAIL = {
  institution: {
    slug: 'berkshire',
    manager: '巴菲特',
    nameZh: '伯克希尔·哈撒韦',
    nameEn: 'Berkshire Hathaway Inc',
    cik: '0001067983',
    dataStatus: 'ready',
    syncError: null,
  },
  valueNote: '市值为美元。2023-01-03 之后按美元填报。',
  periods: [{ reportPeriod: '2026-06-30', filedAt: '2026-08-14' }],
  period: {
    reportPeriod: '2026-06-30',
    filedAt: '2026-08-14',
    form: '13F-HR',
    accession: '0001193125-26-000002',
    sourceUrl: 'https://www.sec.gov/Archives/example',
    valueUnit: 'dollars',
  },
  previousPeriod: { reportPeriod: '2026-03-31', filedAt: '2026-05-15' },
  positions: [
    {
      cusip: '037833100', ticker: 'AAPL', issuerName: 'APPLE INC', titleOfClass: 'COM',
      putCall: '', shareType: 'SH', shares: 200, valueUsd: 2000, weight: 0.8,
      change: 'increased', prevShares: 100, prevValueUsd: 900, shareDelta: 100, valueDeltaUsd: 1100,
    },
    {
      cusip: '594918104', ticker: null, issuerName: 'MICROSOFT CORP', titleOfClass: 'COM',
      putCall: '', shareType: 'SH', shares: 50, valueUsd: 500, weight: 0.2,
      change: 'new', prevShares: 0, prevValueUsd: 0, shareDelta: 50, valueDeltaUsd: 500,
    },
    {
      cusip: '02005N100', ticker: null, issuerName: 'ALLY FINL INC', titleOfClass: 'COM',
      putCall: '', shareType: 'SH', shares: 8, valueUsd: 80, weight: 0,
      change: 'decreased', prevShares: 10, prevValueUsd: 90, shareDelta: -2, valueDeltaUsd: -10,
    },
    {
      cusip: '037833100', ticker: 'AAPL', issuerName: 'APPLE INC', titleOfClass: 'NOTE',
      putCall: 'Put', shareType: 'PRN', shares: 1_000_000, valueUsd: 1000, weight: 0.1,
      change: 'unchanged', prevShares: 1_000_000, prevValueUsd: 1000, shareDelta: null, valueDeltaUsd: 0,
    },
  ],
  closed: [
    {
      cusip: '191216100', ticker: 'KO', issuerName: 'COCA COLA CO', titleOfClass: 'COM',
      putCall: '', shareType: 'SH', shares: 0, valueUsd: 0, weight: null,
      change: 'closed', prevShares: 10, prevValueUsd: 100, shareDelta: -10, valueDeltaUsd: -100,
    },
  ],
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

test('列表给出摘要，没有申报的机构标暂无数据', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(LIST)))
  render(
    <MemoryRouter>
      <WhalesPage />
    </MemoryRouter>,
  )
  const link = await screen.findByRole('link', { name: '巴菲特' })
  expect(link.getAttribute('href')).toBe('/whales/berkshire')
  expect(screen.getByText('伯克希尔·哈撒韦')).toBeTruthy()
  expect(screen.getByText('2026-06-30')).toBeTruthy()
  expect(screen.getByText(formatUsd(2500))).toBeTruthy()
  expect(screen.getByText('AAPL')).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: '市值合计（美元）' })).toBeTruthy()
  expect(screen.getByText('暂无数据')).toBeTruthy()
  expect(screen.getByText('最近一次拉取失败')).toBeTruthy()
  expect(screen.getByText('迈克尔·伯里')).toBeTruthy()
  expect(screen.getByText('美国 SEC Form 13F 的公开申报。')).toBeTruthy()
  expect(screen.getByText(/13F 通常在季末后 45 天内申报/)).toBeTruthy()
  expect(screen.queryByText(/众议院年度披露按年公布/)).toBeNull()
  expect(screen.queryByRole('button', { name: '添加机构' })).toBeNull()
  expect(screen.queryByRole('columnheader', { name: '操作' })).toBeNull()
  expect(screen.queryByRole('button', { name: '删除' })).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('名单里有众议院披露时，副标题和页脚同时写到 13F 和众议院', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
    ...LIST,
    institutions: [
      ...LIST.institutions,
      {
        slug: 'pelosi',
        manager: '佩洛西',
        nameZh: '美国众议院',
        nameEn: 'U.S. House of Representatives',
        cik: 'house:pelosi',
        source: 'house-fd',
        dataStatus: 'ready',
        syncError: null,
        latest: {
          reportPeriod: '2025-12-31',
          filedAt: '2026-05-15',
          form: '年度披露',
          positionCount: 20,
          totalValueUsd: 1,
          top: { issuerName: 'Apple Inc. (AAPL)', ticker: 'AAPL', cusip: 'AAPL' },
        },
      },
    ],
  })))
  render(
    <MemoryRouter>
      <WhalesPage />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('link', { name: '佩洛西' })).toBeTruthy()
  expect(screen.getByText('美国 SEC Form 13F 的公开申报，以及众议院年度财务披露。')).toBeTruthy()
  const footer = screen.getByText(/众议院年度披露按年公布/)
  expect(footer.textContent).toContain('13F 通常在季末后 45 天内申报')
  expect(footer.textContent).toContain('金额是申报区间')
})

test('名单只剩众议院披露时，副标题和页脚不再写成整表都是 13F', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
    valueNote: '金额是申报区间。',
    institutions: [
      {
        slug: 'pelosi',
        manager: '佩洛西',
        nameZh: '美国众议院',
        nameEn: 'U.S. House of Representatives',
        cik: 'house:pelosi',
        source: 'house-fd',
        dataStatus: 'empty',
        syncError: null,
        latest: null,
      },
    ],
  })))
  render(
    <MemoryRouter>
      <WhalesPage />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('link', { name: '佩洛西' })).toBeTruthy()
  expect(screen.getByText('美国众议院年度财务披露。')).toBeTruthy()
  expect(screen.queryByText(/13F 通常在季末后/)).toBeNull()
  expect(screen.getByText(/众议院年度披露按年公布，金额是申报区间/)).toBeTruthy()
})

test('管理员添加机构后，名单里能看到新人', async () => {
  const user = userEvent.setup()
  let added = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url)
    if (path.includes('/api/auth/')) {
      return jsonResponse({
        id: 'u1', username: 'admin', avatarUrl: null, messageCount: 0,
        limit: 100, unlimited: false, isAdmin: true, remaining: 100,
      })
    }
    if (path.endsWith('/api/whales') && init?.method === 'POST') {
      added = true
      return jsonResponse({ sync: 'pending' }, 201)
    }
    if (path.includes('/api/whales')) {
      const institutions = added
        ? [...LIST.institutions, {
          slug: 'baidu-inc', manager: '李彦宏', nameZh: '百度', nameEn: 'Baidu, Inc.',
          cik: '0001234567', dataStatus: 'empty' as const, syncError: null, latest: null,
        }]
        : LIST.institutions
      return jsonResponse({ ...LIST, institutions })
    }
    return jsonResponse({ updatedAt: null, holdings: [] })
  }))
  render(
    <MemoryRouter>
      <WhalesPage />
    </MemoryRouter>,
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.click(await screen.findByRole('button', { name: '添加机构' }))
  const dialog = screen.getByRole('dialog', { name: '添加机构' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  await user.type(screen.getByLabelText('CIK'), '1234567')
  await user.type(screen.getByLabelText('管理人'), '李彦宏')
  await user.type(screen.getByLabelText('中文名'), '百度')
  await user.type(screen.getByLabelText('英文名'), 'Baidu, Inc.')
  await user.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByRole('link', { name: '李彦宏' })).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '添加机构' }))
  expect(screen.getAllByText('暂无数据').length).toBeGreaterThan(1)
})

const ADMIN = {
  id: 'u1', username: 'admin', avatarUrl: null, messageCount: 0,
  limit: 100, unlimited: false, isAdmin: true, remaining: 100,
}

function stubAdminFetch(onDelete: () => Promise<Response> | Response) {
  vi.stubGlobal('confirm', () => true)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url)
    if (path.includes('/api/auth/')) return jsonResponse(ADMIN)
    if (init?.method === 'DELETE') return onDelete()
    if (path.includes('/api/whales')) return jsonResponse(LIST)
    return jsonResponse({ updatedAt: null, holdings: [] })
  }))
}

test('添加失败时弹窗留着，并显示接口返回的原因', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url)
    if (path.includes('/api/auth/')) return jsonResponse(ADMIN)
    if (path.endsWith('/api/whales') && init?.method === 'POST') {
      return jsonResponse({ message: '这个 CIK 已经有机构了' }, 409)
    }
    if (path.includes('/api/whales')) return jsonResponse(LIST)
    return jsonResponse({ updatedAt: null, holdings: [] })
  }))
  render(
    <MemoryRouter>
      <WhalesPage />
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: '添加机构' }))
  await user.type(screen.getByLabelText('CIK'), '1067983')
  await user.type(screen.getByLabelText('管理人'), '巴菲特')
  await user.type(screen.getByLabelText('中文名'), '伯克希尔')
  await user.click(screen.getByRole('button', { name: '保存' }))
  const reason = await screen.findByRole('alert')
  expect(reason.textContent).toBe('这个 CIK 已经有机构了')
  expect(screen.getByRole('dialog', { name: '添加机构' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '巴菲特' })).toBeTruthy()
})

test('添加弹窗锁住页面滚动，Tab 在弹窗内循环，关闭后焦点回到添加机构', async () => {
  const user = userEvent.setup()
  document.body.style.overflow = 'auto'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url)
    if (path.includes('/api/auth/')) return jsonResponse(ADMIN)
    if (path.includes('/api/whales')) return jsonResponse(LIST)
    return jsonResponse({ updatedAt: null, holdings: [] })
  }))
  render(
    <MemoryRouter>
      <WhalesPage />
    </MemoryRouter>,
  )
  const open = await screen.findByRole('button', { name: '添加机构' })
  await user.click(open)
  expect(document.body.style.overflow).toBe('hidden')
  const cik = screen.getByLabelText('CIK')
  expect(document.activeElement).toBe(cik)

  await user.tab()
  expect(document.activeElement).toBe(screen.getByLabelText('管理人'))
  await user.tab({ shift: true })
  expect(document.activeElement).toBe(cik)
  await user.tab({ shift: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '保存' }))
  await user.tab()
  expect(document.activeElement).toBe(cik)

  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.body.style.overflow).toBe('auto')
  expect(document.activeElement).toBe(open)

  await user.click(open)
  expect(document.body.style.overflow).toBe('hidden')
  await user.click(screen.getByRole('button', { name: '取消' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.body.style.overflow).toBe('auto')
  expect(document.activeElement).toBe(open)
})

test('按 Esc 或点遮罩会关掉添加弹窗', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url)
    if (path.includes('/api/auth/')) return jsonResponse(ADMIN)
    if (path.includes('/api/whales')) return jsonResponse(LIST)
    return jsonResponse({ updatedAt: null, holdings: [] })
  }))
  render(
    <MemoryRouter>
      <WhalesPage />
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: '添加机构' }))
  expect(screen.getByRole('dialog', { name: '添加机构' })).toBeTruthy()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()

  await user.click(screen.getByRole('button', { name: '添加机构' }))
  const dialog = screen.getByRole('dialog', { name: '添加机构' })
  fireEvent.mouseDown(dialog.parentElement!)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('删除在表格最右一列，不跟管理人挤在一起', async () => {
  stubAdminFetch(async () => jsonResponse(null, 204))
  render(
    <MemoryRouter>
      <WhalesPage />
    </MemoryRouter>,
  )
  const link = await screen.findByRole('link', { name: '巴菲特' })
  const headers = screen.getAllByRole('columnheader').map(header => header.textContent)
  expect(headers.at(-1)).toBe('操作')
  const cells = link.closest('tr')!.querySelectorAll('td')
  expect(cells[0]!.querySelector('button')).toBeNull()
  const remove = cells[cells.length - 1]!.querySelector('button')
  expect(remove?.textContent).toBe('删除')
  expect(remove?.getAttribute('aria-label')).toBe('删除 巴菲特')
  expect(screen.getByRole('button', { name: '删除 迈克尔·伯里' })).toBeTruthy()
  expect(cells[cells.length - 1]!.className).toContain('text-right')
})

test('删除接口失败时名单还在，只提示删除失败', async () => {
  const user = userEvent.setup()
  stubAdminFetch(async () => jsonResponse({ error: 'nope' }, 500))
  render(
    <MemoryRouter>
      <WhalesPage />
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: '删除 巴菲特' }))
  expect(await screen.findByText('删除失败')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '名家持仓' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '巴菲特' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '迈克尔·伯里' })).toBeTruthy()
  expect(screen.queryByText('名家持仓加载失败')).toBeNull()
})

test('删除请求抛错时名单还在，走同一句删除失败', async () => {
  const user = userEvent.setup()
  stubAdminFetch(() => { throw new Error('network') })
  render(
    <MemoryRouter>
      <WhalesPage />
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: '删除 巴菲特' }))
  expect(await screen.findByText('删除失败')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '名家持仓' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '巴菲特' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '迈克尔·伯里' })).toBeTruthy()
})

test('详情同时列出持仓和四类增减', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(DETAIL)))
  render(
    <MemoryRouter initialEntries={['/whales/berkshire']}>
      <Routes>
        <Route path="/whales/:slug" element={<WhaleDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('heading', { name: '巴菲特' })).toBeTruthy()
  const back = screen.getByRole('link', { name: '名家持仓' })
  expect(back.getAttribute('href')).toBe('/whales')
  expect(back.textContent).not.toContain('←')
  expect(back.querySelector('[data-icon="LeftOutlined"]')).toBeTruthy()
  expect(screen.getAllByRole('columnheader', { name: '市值（美元）' }).length).toBeGreaterThan(0)
  expect(screen.getByText(/对比上期/)).toBeTruthy()
  expect(screen.getByText(/增减按股数，不按市值/)).toBeTruthy()
  expect(screen.getAllByRole('columnheader', { name: '相对上期' }).length).toBeGreaterThan(0)
  expect(screen.getByText('2026-03-31')).toBeTruthy()
  expect(screen.getByText('MICROSOFT CORP')).toBeTruthy()
  expect(screen.getByText('594918104')).toBeTruthy()
  expect(screen.getByText('本金')).toBeTruthy()
  expect(screen.getByText('认沽')).toBeTruthy()
  expect(screen.getAllByText('本金')).toHaveLength(1)

  const increased = screen.getByText(`${changeLabel('increased')} ${formatShareDelta(100)}`)
  const created = screen.getByText(`${changeLabel('new')} ${formatShareDelta(50)}`)
  const decreased = screen.getByText(`${changeLabel('decreased')} ${formatShareDelta(-2)}`)
  const closed = screen.getByText(`${changeLabel('closed')} ${formatShareDelta(-10)}`)
  expect(increased.className).toContain('text-long')
  expect(created.className).toContain('text-long')
  expect(decreased.className).toContain('text-short')
  expect(closed.className).toContain('text-short')
  expect(screen.getByRole('heading', { name: '清仓' })).toBeTruthy()
})

test('详情可以切换报告期，接口没给估算成本时不出成本列', async () => {
  const older = {
    ...DETAIL,
    period: { ...DETAIL.period, reportPeriod: '2026-03-31', filedAt: '2026-05-15' },
    previousPeriod: { reportPeriod: '2025-12-31', filedAt: '2026-02-14' },
    positions: [{
      cusip: '191216100', ticker: 'KO', issuerName: 'COCA COLA CO', titleOfClass: 'COM',
      putCall: '', shareType: 'SH', shares: 4, valueUsd: 40, weight: 1,
      change: 'unchanged', prevShares: 4, prevValueUsd: 40, shareDelta: 0, valueDeltaUsd: 0,
    }],
    closed: [],
  }
  const latest = {
    ...DETAIL,
    periods: [
      { reportPeriod: '2026-06-30', filedAt: '2026-08-14' },
      { reportPeriod: '2026-03-31', filedAt: '2026-05-15' },
    ],
  }
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('period=2026-03-31')) return jsonResponse({ ...older, periods: latest.periods })
    return jsonResponse(latest)
  })
  vi.stubGlobal('fetch', fetchMock)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/whales/berkshire']}>
      <Routes>
        <Route path="/whales/:slug" element={<WhaleDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
  const select = await screen.findByRole('combobox', { name: '报告期' })
  expect((select as HTMLSelectElement).value).toBe('2026-06-30')
  expect(screen.getByText(/没有买入成本/)).toBeTruthy()
  expect(screen.getByText(/浮盈/)).toBeTruthy()
  expect(screen.queryByRole('columnheader', { name: '成本' })).toBeNull()
  expect(screen.queryByRole('columnheader', { name: '浮盈' })).toBeNull()
  await user.selectOptions(select, '2026-03-31')
  expect(await screen.findByText('KO')).toBeTruthy()
  expect(screen.getByText(/COCA COLA CO/)).toBeTruthy()
  expect(screen.getByText('2026-05-15')).toBeTruthy()
  expect(fetchMock.mock.calls.some(call => call[0] === '/api/whales/berkshire?period=2026-03-31')).toBe(true)
})

const TWO_PERIODS = [
  { reportPeriod: '2026-06-30', filedAt: '2026-08-14' },
  { reportPeriod: '2026-03-31', filedAt: '2026-05-15' },
]

function SearchProbe() {
  const { search } = useLocation()
  return <div data-testid="search">{search}</div>
}

function renderWhaleDetail(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/whales/:slug" element={<><WhaleDetailPage /><SearchProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('非法 period 提示格式不对，并回到最新一期', async () => {
  const latest = { ...DETAIL, periods: TWO_PERIODS }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('period=')) return jsonResponse({ error: 'invalid_input' }, 400)
    return jsonResponse(latest)
  }))
  render(
    <StrictMode>
      <MemoryRouter initialEntries={['/whales/berkshire?period=nope']}>
        <Routes>
          <Route path="/whales/:slug" element={<><WhaleDetailPage /><SearchProbe /></>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  )
  expect(await screen.findByText('报告期格式不对，已回到最新一期')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '巴菲特' })).toBeTruthy()
  expect((screen.getByRole('combobox', { name: '报告期' }) as HTMLSelectElement).value).toBe('2026-06-30')
  expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
  await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
})

test('不存在的报告期保留机构和选择器，并回到最新一期', async () => {
  const latest = { ...DETAIL, periods: TWO_PERIODS }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('period=')) return jsonResponse({ error: 'period_not_found' }, 404)
    return jsonResponse(latest)
  }))
  renderWhaleDetail('/whales/berkshire?period=1999-01-01')
  expect(await screen.findByText('没有这一报告期，已回到最新一期')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '巴菲特' })).toBeTruthy()
  expect(screen.getByRole('combobox', { name: '报告期' })).toBeTruthy()
  expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
  await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
})

test('未知机构不会被当成缺报告期回退', async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ error: 'not_found' }, 404))
  vi.stubGlobal('fetch', fetchMock)
  renderWhaleDetail('/whales/missing')
  expect(await screen.findByText('没有这家机构')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '巴菲特' })).toBeNull()
  expect(screen.queryByRole('combobox', { name: '报告期' })).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('切换报告期加载中禁用选择器，并提示加载中', async () => {
  const older = {
    ...DETAIL,
    periods: TWO_PERIODS,
    period: { ...DETAIL.period, reportPeriod: '2026-03-31', filedAt: '2026-05-15' },
    positions: [{
      cusip: 'OLDPERIOD', ticker: 'OLD', issuerName: 'STALE PERIOD INC', titleOfClass: 'COM',
      putCall: '', shareType: 'SH', shares: 1, valueUsd: 1, weight: 1,
      change: null, prevShares: null, prevValueUsd: null, shareDelta: null, valueDeltaUsd: null,
    }],
    closed: [],
  }
  const releases: Array<() => void> = []
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    let release!: () => void
    const body = String(url).includes('period=2026-03-31') ? older : { ...DETAIL, periods: TWO_PERIODS }
    const jsonPromise = new Promise<unknown>(resolve => { release = () => resolve(body) })
    releases.push(release)
    return Promise.resolve({ ok: true, status: 200, json: () => jsonPromise } as Response)
  }))
  const user = userEvent.setup()
  renderWhaleDetail('/whales/berkshire')
  await waitFor(() => expect(releases.length).toBe(1))
  await act(async () => { releases[0]!() })
  const select = await screen.findByRole('combobox', { name: '报告期' }) as HTMLSelectElement
  await user.selectOptions(select, '2026-03-31')
  await waitFor(() => expect(select.disabled).toBe(true))
  expect(screen.getByText('加载中')).toBeTruthy()
  expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
  await act(async () => { releases[1]!() })
  expect(await screen.findByText('OLD')).toBeTruthy()
  expect(select.disabled).toBe(false)
})

test('快速切换报告期时，晚到的旧响应不能盖回持仓', async () => {
  const older = {
    ...DETAIL,
    periods: TWO_PERIODS,
    period: { ...DETAIL.period, reportPeriod: '2026-03-31', filedAt: '2026-05-15' },
    positions: [{
      cusip: 'OLDPERIOD', ticker: 'OLD', issuerName: 'STALE PERIOD INC', titleOfClass: 'COM',
      putCall: '', shareType: 'SH', shares: 1, valueUsd: 1, weight: 1,
      change: null, prevShares: null, prevValueUsd: null, shareDelta: null, valueDeltaUsd: null,
    }],
    closed: [],
  }
  const releases: Array<() => void> = []
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    let release!: () => void
    const body = String(url).includes('period=2026-03-31') ? older : { ...DETAIL, periods: TWO_PERIODS }
    const jsonPromise = new Promise<unknown>(resolve => { release = () => resolve(body) })
    releases.push(release)
    return Promise.resolve({ ok: true, status: 200, json: () => jsonPromise } as Response)
  }))
  function PeriodButtons() {
    const [, setSearchParams] = useSearchParams()
    return (
      <>
        <button type="button" onClick={() => setSearchParams({ period: '2026-03-31' })}>切到旧期</button>
        <button type="button" onClick={() => setSearchParams({})}>切到最新</button>
      </>
    )
  }
  render(
    <MemoryRouter initialEntries={['/whales/berkshire']}>
      <Routes>
        <Route path="/whales/:slug" element={<><WhaleDetailPage /><PeriodButtons /></>} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(releases.length).toBe(1))
  await act(async () => { releases[0]!() })
  expect((await screen.findAllByText('AAPL')).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: '切到旧期' }))
  await waitFor(() => expect(releases.length).toBe(2))
  // fetch 已 resolve，让 .then 走进 await response.json()，再切走，旧 json 才晚到。
  await act(async () => { await Promise.resolve() })
  fireEvent.click(screen.getByRole('button', { name: '切到最新' }))
  await waitFor(() => expect(releases.length).toBe(3))
  await act(async () => { releases[2]!() })
  await act(async () => { releases[1]!() })
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByText('OLD')).toBeNull()
  expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
})

test('众议院详情按区间中点说明增减，股数差为 0 时不带 +0', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
    ...DETAIL,
    institution: { ...DETAIL.institution, source: 'house-fd', manager: '佩洛西', slug: 'pelosi' },
    valueNote: '金额是申报区间。有上一期时，增减也按区间中点，不按股数。',
    period: { ...DETAIL.period, form: '年度披露', reportPeriod: '2025-12-31' },
    previousPeriod: { reportPeriod: '2024-12-31', filedAt: '2025-05-15' },
    positions: [{
      cusip: 'AAPL', ticker: 'AAPL', issuerName: 'Apple Inc. (AAPL)', titleOfClass: 'COM',
      putCall: '', shareType: '', shares: 0, valueUsd: 15_000_000, valueLabel: '5,000,001–25,000,000',
      weight: 1, change: 'increased', prevShares: 0, prevValueUsd: 3_000_000, shareDelta: 0, valueDeltaUsd: 12_000_000,
    }],
    closed: [{
      cusip: 'DIS', ticker: 'DIS', issuerName: 'Walt Disney Company (DIS)', titleOfClass: 'COM',
      putCall: '', shareType: '', shares: 0, valueUsd: 0, valueLabel: '500,001–1,000,000',
      weight: null, change: 'closed', prevShares: 0, prevValueUsd: 750_000, shareDelta: 0, valueDeltaUsd: -750_000,
    }],
  })))
  render(
    <MemoryRouter initialEntries={['/whales/pelosi']}>
      <Routes>
        <Route path="/whales/:slug" element={<WhaleDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('heading', { name: '佩洛西' })).toBeTruthy()
  expect(screen.getByText(/增减按申报区间中点，不按股数/)).toBeTruthy()
  expect(screen.queryByText(/增减按股数/)).toBeNull()
  expect(screen.getAllByRole('columnheader', { name: '相对上期' }).length).toBeGreaterThan(0)
  expect(screen.getByText('加仓').textContent).toBe('加仓')
  expect(screen.getAllByText('清仓').length).toBeGreaterThan(1)
  expect(screen.getByRole('heading', { name: '清仓' })).toBeTruthy()
  expect(screen.getByText(/加仓、新建仓为红/)).toBeTruthy()
  expect(screen.getByText('500,001–1,000,000')).toBeTruthy()
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
})

test('没有上期时不渲染相对上期列', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
    ...DETAIL,
    institution: { ...DETAIL.institution, source: 'house-fd', manager: '佩洛西', slug: 'pelosi' },
    valueNote: '金额是申报区间。有上一期时，增减也按区间中点，不按股数。',
    previousPeriod: null,
    positions: [{
      cusip: 'AAPL', ticker: 'AAPL', issuerName: 'Apple Inc. (AAPL)', titleOfClass: 'COM',
      putCall: '', shareType: '', shares: 0, valueUsd: 15_000_000, valueLabel: '5,000,001–25,000,000',
      weight: 1, change: null, prevShares: null, prevValueUsd: null, shareDelta: null, valueDeltaUsd: null,
    }],
    closed: [],
  })))
  render(
    <MemoryRouter initialEntries={['/whales/pelosi']}>
      <Routes>
        <Route path="/whales/:slug" element={<WhaleDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('heading', { name: '佩洛西' })).toBeTruthy()
  expect(screen.getByText(/暂无上期可对比/)).toBeTruthy()
  expect(screen.queryByRole('columnheader', { name: '相对上期' })).toBeNull()
  expect(screen.queryByText('加仓')).toBeNull()
  expect(screen.queryByRole('heading', { name: '清仓' })).toBeNull()
  expect(screen.getByText('5,000,001–25,000,000')).toBeTruthy()
})

test('导航有名家持仓；功能关闭时去掉', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/whales')) return jsonResponse({ error: 'whales_disabled' }, 404)
    return jsonResponse(null, 500)
  }))
  render(
    <StrictMode>
      <MemoryRouter>
        <HoldingsProvider>
          <SiteHeader />
        </HoldingsProvider>
      </MemoryRouter>
    </StrictMode>,
  )
  await waitFor(() => expect(screen.queryAllByRole('link', { name: '名家持仓' })).toHaveLength(0))
})

test('功能开启时桌面和移动导航都有名家持仓', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url)
    if (path.includes('/api/whales')) return jsonResponse(LIST)
    if (path.includes('/api/auth/')) return jsonResponse(null, 401)
    return jsonResponse({ updatedAt: null, holdings: [] })
  }))
  render(
    <MemoryRouter initialEntries={['/whales']}>
      <HoldingsProvider>
        <SiteHeader />
      </HoldingsProvider>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getAllByRole('link', { name: '名家持仓' })).toHaveLength(2))
  for (const link of screen.getAllByRole('link', { name: '名家持仓' })) {
    expect(link.getAttribute('href')).toBe('/whales')
    expect(link.getAttribute('aria-current')).toBe('page')
  }
})

test('详情给出估算成本、期末价和相对成本，起算的仓位标出起算期', async () => {
  const withCost = {
    ...DETAIL,
    costNote: '13F 没有买入成本。估算成本按库内各期申报倒推。',
    costSummary: { costUsd: 2400, valueUsd: 2500, gain: 2500 / 2400 - 1, coveredWeight: 0.9, partialWeight: 0.8 },
    positions: [
      { ...DETAIL.positions[0], cost: { costPerShare: 9.5, pricePerShare: 10, gain: 10 / 9.5 - 1, since: '2026-03-31', fromStart: false } },
      { ...DETAIL.positions[1], cost: { costPerShare: 12, pricePerShare: 10, gain: 10 / 12 - 1, since: '2026-06-30', fromStart: true } },
      { ...DETAIL.positions[3], cost: null },
    ],
  }
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(withCost)))
  render(
    <MemoryRouter initialEntries={['/whales/berkshire']}>
      <Routes>
        <Route path="/whales/:slug" element={<WhaleDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('columnheader', { name: '估算成本（美元）' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: '期末价（美元）' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: '相对成本' })).toBeTruthy()
  expect(screen.getByText('9.50')).toBeTruthy()
  expect(screen.getByText('起算 2026-03-31')).toBeTruthy()
  expect(screen.getByText('+5.3%').className).toContain('text-long')
  expect(screen.getByText('-16.7%').className).toContain('text-short')
  expect(screen.getByText(/估算成本合计/)).toBeTruthy()
  expect(screen.getByText(/覆盖本期市值的 90.00%/)).toBeTruthy()
  expect(screen.getByText(/估算成本按库内各期申报倒推/)).toBeTruthy()
})
