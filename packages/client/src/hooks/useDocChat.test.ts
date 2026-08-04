import { test, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useDocChat } from './useDocChat'

// useDocChat 挂载时会动态 import('../api') 去拉历史消息,这里换成空历史的替身,
// 免得测试打到真实 fetch。
vi.mock('../api', () => ({
  api: { getMessages: vi.fn().mockResolvedValue([]) },
}))

afterEach(() => { vi.unstubAllGlobals() })

function stubFetchNotOk(status: number, body: unknown) {
  // 真实的 Fastify 400 是带 body 的:配一个真的 ReadableStream(单个 chunk 装
  // 编码后的 JSON),不然 mock 直接缺了 res.body,`if (!res.ok)` 判断前挂掉的
  // 反而是 `if (!res.body) throw new Error('无响应流')`——测出来的是「没有响应
  // 流」这个 mock 自身的缺陷,不是真正要防的 bug(旧代码会把这段 JSON 当 SSE
  // 分片去读,split('\n\n') 只有一段、被 parts.pop() 吃掉,循环一次都不跑,
  // 用户看到的是一个永远停在「…」的空气泡)。
  const encoded = new TextEncoder().encode(JSON.stringify(body))
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    },
  })
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false,
    status,
    body: stream,
    json: async () => body,
  } as unknown as Response)))
}

test('400 llm_config_invalid:预流式错误要显示 message,并带「模型设置」提示', async () => {
  stubFetchNotOk(400, { error: 'llm_config_invalid', message: '模型配置已失效,请重新填写 API key' })
  const { result } = renderHook(() => useDocChat('doc-1'))

  await act(async () => {
    await result.current.send('你好')
  })

  const assistant = result.current.messages.at(-1)
  expect(assistant?.content).toContain('模型配置已失效,请重新填写 API key')
  expect(assistant?.content).toContain('去「模型设置」')
  expect(result.current.streaming).toBe(false)
})

test('403 message_limit_reached:预流式错误也要显示出来,不能是空气泡', async () => {
  stubFetchNotOk(403, { error: 'message_limit_reached', scope: 'user', limit: 10 })
  const { result } = renderHook(() => useDocChat('doc-1'))

  await act(async () => {
    await result.current.send('你好')
  })

  const assistant = result.current.messages.at(-1)
  expect(assistant?.content.trim()).not.toBe('')
  expect(assistant?.content).toContain('message_limit_reached')
  expect(result.current.streaming).toBe(false)
})

test('非 JSON 错误体:不抛异常,退化成通用错误文案', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false,
    status: 502,
    json: async () => { throw new SyntaxError('not json') },
  } as unknown as Response)))
  const { result } = renderHook(() => useDocChat('doc-1'))

  await act(async () => {
    await result.current.send('你好')
  })

  const assistant = result.current.messages.at(-1)
  expect(assistant?.content.trim()).not.toBe('')
  expect(result.current.streaming).toBe(false)
})

test('挂载后等待历史消息加载完(冒烟,确认动态 import 的替身生效)', async () => {
  const { result } = renderHook(() => useDocChat('doc-1'))
  await waitFor(() => expect(result.current.messages).toEqual([]))
})
