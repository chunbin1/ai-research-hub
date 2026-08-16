import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AdminPage from './AdminPage'

const ADMIN = { id: 'u1', username: 'lee', avatarUrl: null, messageCount: 0, limit: 10, unlimited: false, isAdmin: true, remaining: 10 }
const NORMAL = { ...ADMIN, isAdmin: false }

const FROM_ENV = {
  providerId: 'zhipu',
  model: 'glm-4.7',
  source: 'env',
  envModel: 'glm-4.7',
  suggestedModels: ['glm-4.7-flash', 'glm-4.7'],
  configError: null,
}

const FROM_DB = { ...FROM_ENV, model: 'glm-4.7-flash', source: 'db' }

/** 同时给 /api/auth/me 和 /api/site-model 兜底,页面会各拉一次。 */
function stubFetch(opts: {
  me?: unknown
  siteModel?: unknown
  onPut?: () => { ok: boolean; body: unknown }
  onDelete?: () => { ok: boolean; body: unknown }
}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return { ok: true, json: async () => opts.me ?? ADMIN } as Response
    if (init?.method === 'PUT') {
      const r = opts.onPut?.() ?? { ok: true, body: { ok: true } }
      return { ok: r.ok, json: async () => r.body } as Response
    }
    if (init?.method === 'DELETE') {
      const r = opts.onDelete?.() ?? { ok: true, body: { ok: true } }
      return { ok: r.ok, json: async () => r.body } as Response
    }
    return { ok: true, json: async () => opts.siteModel ?? FROM_ENV } as Response
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

function renderPage() {
  return render(<MemoryRouter><AdminPage /></MemoryRouter>)
}

function modelInput(container: HTMLElement) {
  return container.querySelector('input[placeholder="模型名"]') as HTMLInputElement
}

test('非管理员看到权限提示,看不到表单', async () => {
  stubFetch({ me: NORMAL })
  const { container } = renderPage()
  expect(await screen.findByText(/需要管理员权限/)).toBeTruthy()
  expect(modelInput(container)).toBeNull()
})

test('渲染当前生效模型,来源为 .env 时不显示恢复按钮', async () => {
  stubFetch({ siteModel: FROM_ENV })
  const { container } = renderPage()
  await waitFor(() => expect(modelInput(container)?.value).toBe('glm-4.7'))
  expect(screen.getByText(/来自 \.env/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '恢复为 .env 默认' })).toBeNull()
})

test('来源为 db 时显示恢复按钮,并标注已覆盖', async () => {
  stubFetch({ siteModel: FROM_DB })
  renderPage()
  expect(await screen.findByText(/已在此覆盖/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '恢复为 .env 默认' })).toBeTruthy()
})

test('保存把输入框里的模型名 PUT 出去', async () => {
  let sent: string | null = null
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return { ok: true, json: async () => ADMIN } as Response
    if (init?.method === 'PUT') {
      sent = (JSON.parse(String(init.body)) as { model: string }).model
      return { ok: true, json: async () => ({ ok: true }) } as Response
    }
    return { ok: true, json: async () => FROM_ENV } as Response
  }))

  const { container } = renderPage()
  await waitFor(() => expect(modelInput(container)).toBeTruthy())
  fireEvent.change(modelInput(container), { target: { value: 'glm-4.7-flash' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(sent).toBe('glm-4.7-flash'))
})

test('探测失败时把服务端的原因显示出来', async () => {
  stubFetch({
    onPut: () => ({ ok: false, body: { error: 'probe_failed', message: '模型名不存在,或 baseURL 指向的端点不对' } }),
  })
  const { container } = renderPage()
  await waitFor(() => expect(modelInput(container)).toBeTruthy())
  fireEvent.change(modelInput(container), { target: { value: 'glm-9-nope' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText(/模型名不存在/)).toBeTruthy()
})

test('站长未配 key 时显示 configError', async () => {
  stubFetch({
    siteModel: {
      providerId: null, model: null, source: 'env', envModel: null,
      suggestedModels: [], configError: 'No LLM provider configured. Set ANTHROPIC_API_KEY or ZHIPU_API_KEY in .env',
    },
  })
  renderPage()
  expect(await screen.findByText(/No LLM provider configured/)).toBeTruthy()
})

test('.env 里是降级链时给出会失效的提示', async () => {
  stubFetch({ siteModel: { ...FROM_ENV, model: 'glm-4.7,glm-4-flash', envModel: 'glm-4.7,glm-4-flash' } })
  renderPage()
  expect(await screen.findByText(/降级链/)).toBeTruthy()
})

test('点击恢复为 .env 默认后,输入框回填为 .env 里的模型名,而不是停留在旧的覆盖值', async () => {
  let deleted = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return { ok: true, json: async () => ADMIN } as Response
    if (init?.method === 'DELETE') { deleted = true; return { ok: true, json: async () => ({ ok: true }) } as Response }
    return { ok: true, json: async () => (deleted ? FROM_ENV : FROM_DB) } as Response
  }))

  const { container } = renderPage()
  await waitFor(() => expect(modelInput(container)?.value).toBe('glm-4.7-flash'))
  fireEvent.click(screen.getByRole('button', { name: '恢复为 .env 默认' }))
  await waitFor(() => expect(modelInput(container)?.value).toBe('glm-4.7'))
  // 顺带确认恢复按钮消失,防止管理员误以为还能再次「恢复」
  expect(screen.queryByRole('button', { name: '恢复为 .env 默认' })).toBeNull()
})

test('保存成功后接着修改输入框,已保存提示应随之消失,不能让未保存的草稿看起来已生效', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return { ok: true, json: async () => ADMIN } as Response
    if (init?.method === 'PUT') return { ok: true, json: async () => ({ ok: true }) } as Response
    return { ok: true, json: async () => FROM_ENV } as Response
  }))

  const { container } = renderPage()
  await waitFor(() => expect(modelInput(container)).toBeTruthy())
  fireEvent.change(modelInput(container), { target: { value: 'glm-4.7-flash' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('已保存,下一次提问生效')).toBeTruthy()

  fireEvent.change(modelInput(container), { target: { value: 'glm-4-flash' } })
  await waitFor(() => expect(screen.queryByText('已保存,下一次提问生效')).toBeNull())
})
