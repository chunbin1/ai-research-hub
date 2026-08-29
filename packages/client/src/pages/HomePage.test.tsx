import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomePage from './HomePage'

const DOCS = [
  { id: 'd1', filename: '腾讯生态产业链投资研究报告', size_bytes: 1, chunk_count: 47, created_at: '2026-08-01T00:00:00.000Z' },
  { id: 'd2', filename: '港股互联网:估值重估走到哪一步了', size_bytes: 1, chunk_count: 7, created_at: '2026-07-13T00:00:00.000Z' },
  { id: 'd3', filename: '投研方法论:如何读懂一份看空报告', size_bytes: 1, chunk_count: 8, created_at: '2026-07-12T00:00:00.000Z' },
]

const ADMIN = {
  id: 'u1', username: 'chunbin1', avatarUrl: null, messageCount: 0,
  limit: 100, unlimited: false, isAdmin: true, remaining: 100,
}

/** 按 URL 分发的 fetch 桩:首页要同时打 /api/auth/me 与 /api/documents */
function stubFetch(opts: { user?: unknown; docs?: unknown[] } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/auth/me')) {
      return { ok: opts.user != null, json: async () => opts.user } as Response
    }
    if (url.startsWith('/api/documents')) {
      return { ok: true, json: async () => ({ documents: opts.docs ?? DOCS }) } as Response
    }
    throw new Error(`未桩的请求: ${url}`)
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

function renderHome() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>)
}

test('研报行渲染标题、日期、段数', async () => {
  stubFetch()
  renderHome()

  const row = (await screen.findByText('腾讯生态产业链投资研究报告')).closest('article')!
  expect(within(row).getByText('47 段')).toBeTruthy()
  // 日期在桌面列与移动行里各渲染一次(另一份被 display:none 藏起来),两处都要有
  expect(within(row).getAllByText(/2026\/8\/1/)).toHaveLength(2)
})

// 市场 / 行业标签只能从标题关键词猜,猜错不会报错、只会安静地标错,
// 所以整套推断驱动的 UI(行标签 + 按板块浏览 + 筛选胶囊)都不出。
// 这三条钉住这个决定 —— lib/reportTags.ts 还在,别让它悄悄被接回页面。
test('不渲染从标题猜出来的市场 / 行业标签', async () => {
  stubFetch()
  renderHome()
  const row = (await screen.findByText('港股互联网:估值重估走到哪一步了')).closest('article')!
  expect(within(row).queryByText('港股')).toBeNull()
  expect(within(row).queryByText('互联网')).toBeNull()
})

test('右栏不出现「按板块浏览」', async () => {
  stubFetch()
  renderHome()
  await screen.findByText('腾讯生态产业链投资研究报告')
  expect(screen.queryByText('按板块浏览')).toBeNull()
})

test('移动端不出现板块筛选胶囊', async () => {
  stubFetch()
  renderHome()
  await screen.findByText('腾讯生态产业链投资研究报告')
  expect(screen.queryByRole('button', { name: '全部' })).toBeNull()
})

test('标题链到详情页,整行是同一个点击目标', async () => {
  stubFetch()
  renderHome()
  const link = await screen.findByRole('link', { name: '腾讯生态产业链投资研究报告' })
  expect(link.getAttribute('href')).toBe('/reports/d1')
})

test('栏目头显示研报总篇数', async () => {
  stubFetch()
  renderHome()
  expect(await screen.findByText('共 3 篇')).toBeTruthy()
})

test('非管理员看不到上传入口、删除按钮和管理员栏目', async () => {
  stubFetch({ user: { ...ADMIN, isAdmin: false } })
  renderHome()
  await screen.findByText('腾讯生态产业链投资研究报告')

  expect(screen.queryByText('上传研报')).toBeNull()
  expect(screen.queryByText('删除')).toBeNull()
  expect(screen.queryByText('评估')).toBeNull()
  expect(screen.queryByText('站点模型')).toBeNull()
  // 信号对所有人开放
  expect(screen.getAllByRole('link', { name: '信号' }).length).toBeGreaterThan(0)
})

test('管理员能看到上传入口与管理员栏目', async () => {
  stubFetch({ user: ADMIN })
  renderHome()
  await waitFor(() => { expect(screen.getByText('上传研报')).toBeTruthy() })
  expect(screen.getAllByRole('link', { name: 'trace' }).length).toBeGreaterThan(0)
})

test('未登录显示 GitHub 登录', async () => {
  stubFetch()
  renderHome()
  await waitFor(() => { expect(screen.getByRole('button', { name: 'GitHub 登录' })).toBeTruthy() })
})

test('空列表保留栏目头,正文只给一行说明', async () => {
  stubFetch({ docs: [] })
  renderHome()
  expect(await screen.findByText('还没有研报')).toBeTruthy()
  expect(screen.getByText('最新研报')).toBeTruthy()
  expect(screen.getByText('共 0 篇')).toBeTruthy()
})

// 财报日历只能靠外部数据源,而现成的免费源产出的是「任何门户都有」的通用列表
// (英文名、近一半拿不到盘前/盘后、147 家里绝大多数与本站研报无关),不值得为它
// 加表 + cron + 外部依赖。整块下掉,右栏随之收成单列。
test('不渲染本周财报日历', async () => {
  stubFetch()
  renderHome()
  await screen.findByText('腾讯生态产业链投资研究报告')
  expect(screen.queryByText('本周财报日历')).toBeNull()
})
