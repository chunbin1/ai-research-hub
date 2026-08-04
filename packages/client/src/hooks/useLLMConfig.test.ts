import { test, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useLLMConfig } from './useLLMConfig'

const EMPTY = {
  available: true,
  presets: [{ id: 'deepseek', label: 'DeepSeek', kind: 'openai', suggestedModels: ['deepseek-chat'], custom: false }],
  config: null,
  effective: { model: 'glm-4-flash', source: 'server', providerId: 'zhipu' },
  configError: null,
}

function stubFetch(impl: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = impl(url, init)
    return { ok: true, json: async () => body } as Response
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

test('挂载后拉配置,loading 归 false', async () => {
  stubFetch(() => EMPTY)
  const { result } = renderHook(() => useLLMConfig())
  expect(result.current.loading).toBe(true)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data?.effective?.source).toBe('server')
})

test('save 成功后重新拉取', async () => {
  let saved = false
  stubFetch((url, init) => {
    if (init?.method === 'PUT') { saved = true; return { ok: true } }
    return saved
      ? { ...EMPTY, config: { providerId: 'deepseek', baseURL: null, model: 'deepseek-chat', keyHint: 'sk-a……7890', enabled: true, updatedAt: 'now' }, effective: { model: 'deepseek-chat', source: 'user', providerId: 'deepseek' } }
      : EMPTY
  })
  const { result } = renderHook(() => useLLMConfig())
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.save({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-abcdefg7890' })
  })
  await waitFor(() => expect(result.current.data?.effective?.source).toBe('user'))
  expect(result.current.data?.config?.keyHint).toBe('sk-a……7890')
})

test('save 失败时把服务端消息放进 error,且不清空已有配置', async () => {
  const SAVED = {
    ...EMPTY,
    config: { providerId: 'deepseek', baseURL: null, model: 'deepseek-chat', keyHint: 'sk-a……7890', enabled: true, updatedAt: 'now' },
    effective: { model: 'deepseek-chat', source: 'user', providerId: 'deepseek' },
  }
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return { ok: false, json: async () => ({ error: 'invalid_base_url', message: 'baseURL 指向内网地址,已拒绝' }) } as Response
    }
    return { ok: true, json: async () => SAVED } as Response
  }))
  const { result } = renderHook(() => useLLMConfig())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data).toEqual(SAVED)

  await act(async () => {
    await result.current.save({ providerId: 'custom', baseURL: 'https://192.168.1.1', model: 'm', apiKey: 'sk-abcdefg7890' })
  })
  expect(result.current.error).toBe('baseURL 指向内网地址,已拒绝')
  // 保存失败后,已保存的配置(含 keyHint 和 effective.source)必须原样保留,不能被清空或改写
  expect(result.current.data).toEqual(SAVED)
})

test('test 把结果放进 testResult', async () => {
  stubFetch((url) => (url.endsWith('/test') ? { ok: false, reason: 'API key 无效或没有权限' } : EMPTY))
  const { result } = renderHook(() => useLLMConfig())
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.test({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-abcdefg7890' })
  })
  expect(result.current.testResult).toEqual({ ok: false, reason: 'API key 无效或没有权限' })
})

test('remove 调 DELETE 并重新拉取', async () => {
  const calls: string[] = []
  stubFetch((url, init) => { calls.push(`${init?.method ?? 'GET'} ${url}`); return EMPTY })
  const { result } = renderHook(() => useLLMConfig())
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => { await result.current.remove() })
  expect(calls).toContain('DELETE /api/llm-config')
})
