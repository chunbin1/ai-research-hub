import { test, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSiteModel } from './useSiteModel'

const FROM_ENV = {
  providerId: 'zhipu',
  model: 'glm-4.7',
  source: 'env',
  envModel: 'glm-4.7',
  suggestedModels: ['glm-4.7-flash', 'glm-4.7'],
  configError: null,
}

const FROM_DB = { ...FROM_ENV, model: 'glm-4.7-flash', source: 'db' }

function stubFetch(impl: (url: string, init?: RequestInit) => { ok?: boolean; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const { ok = true, body } = impl(url, init)
    return { ok, json: async () => body } as Response
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

test('挂载后拉配置,loading 归 false', async () => {
  stubFetch(() => ({ body: FROM_ENV }))
  const { result } = renderHook(() => useSiteModel())
  expect(result.current.loading).toBe(true)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data?.source).toBe('env')
  expect(result.current.data?.model).toBe('glm-4.7')
})

test('save 成功后重新拉取,source 变成 db', async () => {
  let saved = false
  stubFetch((_url, init) => {
    if (init?.method === 'PUT') { saved = true; return { body: { ok: true } } }
    return { body: saved ? FROM_DB : FROM_ENV }
  })
  const { result } = renderHook(() => useSiteModel())
  await waitFor(() => expect(result.current.loading).toBe(false))

  let ret: boolean | undefined
  await act(async () => { ret = await result.current.save('glm-4.7-flash') })
  expect(ret).toBe(true)
  await waitFor(() => expect(result.current.data?.source).toBe('db'))
  expect(result.current.saved).toBe(true)
  expect(result.current.error).toBeNull()
})

test('save 失败时把服务端的 message 放进 error,不改 data', async () => {
  stubFetch((_url, init) => {
    if (init?.method === 'PUT') {
      return { ok: false, body: { error: 'probe_failed', message: '模型名不存在,或 baseURL 指向的端点不对' } }
    }
    return { body: FROM_ENV }
  })
  const { result } = renderHook(() => useSiteModel())
  await waitFor(() => expect(result.current.loading).toBe(false))

  let ret: boolean | undefined
  await act(async () => { ret = await result.current.save('glm-9-nope') })
  expect(ret).toBe(false)
  expect(result.current.error).toMatch(/模型名不存在/)
  expect(result.current.saved).toBe(false)
  expect(result.current.data?.source).toBe('env')
})

test('reset 发 DELETE 并重新拉取', async () => {
  let removed = false
  const seen: string[] = []
  stubFetch((_url, init) => {
    seen.push(init?.method ?? 'GET')
    if (init?.method === 'DELETE') { removed = true; return { body: { ok: true } } }
    return { body: removed ? FROM_ENV : FROM_DB }
  })
  const { result } = renderHook(() => useSiteModel())
  await waitFor(() => expect(result.current.data?.source).toBe('db'))

  await act(async () => { await result.current.reset() })
  expect(seen).toContain('DELETE')
  await waitFor(() => expect(result.current.data?.source).toBe('env'))
})
