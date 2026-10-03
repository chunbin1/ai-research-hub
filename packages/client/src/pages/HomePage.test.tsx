import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import HomePage from './HomePage'
import { SiteLayout } from '../components/SiteLayout'

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

// 顶栏(上传入口、管理员栏目)挂在 SiteLayout 上,和线上一样套着渲染
function renderHome(url = '/') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<HomePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

test('研报行渲染标题、日期、段数', async () => {
  stubFetch()
  renderHome()

  const row = (await screen.findByText('腾讯生态产业链投资研究报告')).closest('article')!
  // 桌面的段数列 + 移动端的「日期 · 段数」行(另一份被 display:none 藏起来),两处都要有
  expect(within(row).getByText('2026/8/1 · 47 段')).toBeTruthy()
  expect(within(row).getByText('2026/8/1')).toBeTruthy()
})

test('更新过的研报:日期显示更新日,另挂「vN」标签', async () => {
  stubFetch({ docs: [{ ...DOCS[0], latest_version: 3, updated_at: '2026-09-26T00:00:00.000Z' }, DOCS[1]] })
  renderHome()
  const row = (await screen.findByText('腾讯生态产业链投资研究报告')).closest('article')!
  // 前面的用例会把 DOCS 写进 localStorage 缓存,首帧画的是缓存里没更新过的那一版;
  // 得等服务端结果覆盖上来再断言,不然全量跑时偶发抢跑
  expect(await within(row).findByText('2026/9/26')).toBeTruthy()
  expect(within(row).getByText('2026/9/26 · 47 段')).toBeTruthy()
  expect(within(row).queryByText('2026/8/1')).toBeNull()
  // 桌面跟在标题后、移动端在日期行前,各一份
  expect(within(row).getAllByText('v3')).toHaveLength(2)
  // 没更新过的不挂
  const plain = screen.getByText('港股互联网:估值重估走到哪一步了').closest('article')!
  expect(within(plain).queryByText(/^v\d/)).toBeNull()
})

test('管理员:移动端「⋯」打开行操作菜单', async () => {
  stubFetch({ user: ADMIN })
  renderHome()
  const more = await screen.findByRole('button', { name: '「腾讯生态产业链投资研究报告」的更多操作' })
  more.click()
  await waitFor(() => expect(document.querySelector('.home-row-menu.ant-drawer-open')).toBeTruthy())
  expect(screen.getByRole('button', { name: '上传新版本' })).toBeTruthy()
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
  expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /更多操作/ })).toBeNull()
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

// ---- 上传研报弹窗 ----

test('管理员:点「上传研报」打开弹窗,拖入 .md 点「上传」→ 走上传接口,关弹窗并刷新列表', async () => {
  const NEW_DOC = { id: 'd9', filename: '新拖进来的研报', size_bytes: 1, chunk_count: 3, created_at: '2026-09-26T00:00:00.000Z' }
  let uploaded = false
  const posts: FormData[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/auth/me')) return { ok: true, json: async () => ADMIN } as Response
    if (url === '/api/documents/similar') {
      return { ok: true, json: async () => ({ title: '新研报', candidates: [] }) } as Response
    }
    if (url === '/api/documents' && init?.method === 'POST') {
      posts.push(init.body as FormData)
      uploaded = true
      return { ok: true, json: async () => ({ document: NEW_DOC }) } as Response
    }
    if (url.startsWith('/api/documents')) {
      return { ok: true, json: async () => ({ documents: uploaded ? [NEW_DOC, ...DOCS] : DOCS }) } as Response
    }
    throw new Error(`未桩的请求: ${url}`)
  }))
  renderHome()

  fireEvent.click(await screen.findByRole('button', { name: '上传研报' }))
  const dialog = await screen.findByRole('dialog')
  const zone = within(dialog).getByRole('button', { name: /拖拽文件到此处，或点击选择文件/ })
  const f = new File(['# 新研报\n'], '新研报.md', { type: 'text/markdown' })
  fireEvent.drop(zone, { dataTransfer: { files: [f], types: ['Files'] } })
  // 先查重,库里没有像的才放行
  const ok = within(dialog).getByRole('button', { name: '上传' }) as HTMLButtonElement
  await waitFor(() => expect(ok.disabled).toBe(false))
  fireEvent.click(ok)

  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].get('file')).toBe(f)
  expect(await screen.findByText('新拖进来的研报')).toBeTruthy()
  expect(screen.getByText('共 4 篇')).toBeTruthy()
  // 弹窗关掉(antd 关闭动画在测试环境里不会跑完,认 dialog 不再可见)
  // 弹窗进入关闭动画(测试环境里动画不会跑完,认 leave 状态)
  await waitFor(() => expect(document.querySelector('.ant-modal')?.className).toContain('ant-zoom-leave'))
})

test('管理员:研报行上的「上传新版本」打开带大拖拽区的弹窗', async () => {
  stubFetch({ user: ADMIN })
  renderHome()
  fireEvent.click(await screen.findByRole('button', { name: '给「腾讯生态产业链投资研究报告」上传新版本' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('上传新版本 v2')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: /拖拽文件到此处，或点击选择文件/ })).toBeTruthy()
})


// ── 行业 / 公司 ───────────────────────────────────────────────────────────

const WITH_COMPANY = [
  ...DOCS,
  { id: 'd4', filename: '中国海洋石油（0883.HK / 600938.SH）投资研究报告', size_bytes: 1, chunk_count: 30, created_at: '2026-10-02T00:00:00.000Z', kind: 'company' },
  { id: 'd5', filename: 'SK海力士（KRX: 000660 / NASDAQ: SKHY）投资研究报告', size_bytes: 1, chunk_count: 30, created_at: '2026-10-02T00:00:00.000Z', kind: 'company' },
]

test('库里没有公司研报时不出类型筛选(旧缓存里没有 kind 的也算行业)', async () => {
  stubFetch()
  renderHome()
  await screen.findByText('腾讯生态产业链投资研究报告')
  expect(screen.queryByRole('navigation', { name: '研报类型' })).toBeNull()
  expect(screen.queryByText('公司')).toBeNull()
})

test('有公司研报:出「全部 / 行业 / 公司」筛选并带计数,默认全部', async () => {
  stubFetch({ docs: WITH_COMPANY })
  renderHome()
  const nav = await screen.findByRole('navigation', { name: '研报类型' })
  expect(within(nav).getByRole('button', { name: /全部/ }).getAttribute('aria-pressed')).toBe('true')
  expect(within(nav).getByRole('button', { name: /全部/ }).textContent).toBe('全部5')
  expect(within(nav).getByRole('button', { name: /行业/ }).textContent).toBe('行业3')
  expect(within(nav).getByRole('button', { name: /公司/ }).textContent).toBe('公司2')
  expect(screen.getByText('共 5 篇')).toBeTruthy()
})

test('全部视图里公司研报挂「公司」小标,行业研报不挂', async () => {
  stubFetch({ docs: WITH_COMPANY })
  renderHome()
  const co = (await screen.findByText(/^中国海洋石油（0883/)).closest('article')!
  // 桌面跟在标题后、移动端在日期行里,各一份
  expect(within(co).getAllByText('公司')).toHaveLength(2)
  const ind = screen.getByText('腾讯生态产业链投资研究报告').closest('article')!
  expect(within(ind).queryByText('公司')).toBeNull()
})

test('点「公司」只留公司研报,计数跟着变,URL 记住筛选', async () => {
  stubFetch({ docs: WITH_COMPANY })
  renderHome()
  const nav = await screen.findByRole('navigation', { name: '研报类型' })
  fireEvent.click(within(nav).getByRole('button', { name: /公司/ }))

  await waitFor(() => expect(screen.queryByText('腾讯生态产业链投资研究报告')).toBeNull())
  expect(screen.getByText(/^中国海洋石油（0883/)).toBeTruthy()
  expect(screen.getByText(/^SK海力士/)).toBeTruthy()
  expect(screen.getByText('共 2 篇')).toBeTruthy()
  expect(within(nav).getByRole('button', { name: /公司/ }).getAttribute('aria-pressed')).toBe('true')
  // 已经筛到公司了,行上不再重复挂「公司」
  expect(screen.getByText(/^SK海力士/).closest('article')!.textContent).not.toContain('公司')
})

test('直接打开 /?kind=industry:只看行业;不认识的值当全部', async () => {
  stubFetch({ docs: WITH_COMPANY })
  const { unmount } = renderHome('/?kind=industry')
  await screen.findByText('腾讯生态产业链投资研究报告')
  expect(screen.queryByText(/^中国海洋石油（0883/)).toBeNull()
  expect(screen.getByText('共 3 篇')).toBeTruthy()
  unmount()

  renderHome('/?kind=whatever')
  expect(await screen.findByText('共 5 篇')).toBeTruthy()
})

test('筛到的那一类是空的:筛选留着,说明没有,不把人困住', async () => {
  stubFetch({ docs: DOCS })
  renderHome('/?kind=company')
  expect(await screen.findByText('还没有公司研报')).toBeTruthy()
  const nav = screen.getByRole('navigation', { name: '研报类型' })
  fireEvent.click(within(nav).getByRole('button', { name: /全部/ }))
  expect(await screen.findByText('腾讯生态产业链投资研究报告')).toBeTruthy()
})

test('管理员:桌面行上的「改为…」把类型改掉并刷新', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/auth/me')) return { ok: true, json: async () => ADMIN } as Response
    if (init?.method === 'PATCH') return { ok: true, json: async () => ({}) } as Response
    return { ok: true, json: async () => ({ documents: WITH_COMPANY }) } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  renderHome()
  fireEvent.click(await screen.findByRole('button', { name: '把「SK海力士（KRX: 000660 / NASDAQ: SKHY）投资研究报告」改为行业研报' }))
  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(patch?.[0]).toBe('/api/documents/d5')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ kind: 'industry' })
  })
})
