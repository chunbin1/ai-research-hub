import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ChatPanel from './ChatPanel'
import type { AuthUser } from '../hooks/useAuth'
import type { ChatMessage, LLMEffective } from '../types'

// outOfQuota 门槛测试只关心 useAuth / useLLMConfig / useDocChat 返回的数据形状,
// 三个 hook 全部替身掉,避免真实拉取网络请求。
const mockUseAuth = vi.fn()
const mockUseLLMConfig = vi.fn()
const mockMessages = vi.fn((): ChatMessage[] => [])

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))
vi.mock('../hooks/useLLMConfig', () => ({
  useLLMConfig: () => mockUseLLMConfig(),
}))
vi.mock('../hooks/useDocChat', () => ({
  useDocChat: () => ({ messages: mockMessages(), send: vi.fn(), streaming: false }),
}))

const quotaExhaustedUser: AuthUser = {
  id: 'u1',
  username: 'tester',
  avatarUrl: null,
  messageCount: 10,
  limit: 10,
  unlimited: false,
  isAdmin: false,
  remaining: 0,
}

function setup(effective: LLMEffective | null) {
  mockUseAuth.mockReturnValue({ user: quotaExhaustedUser, login: vi.fn() })
  mockUseLLMConfig.mockReturnValue({
    data: { available: true, presets: [], config: null, effective, configError: null },
  })
  return render(
    <MemoryRouter>
      <ChatPanel docId="doc-1" onCite={() => {}} />
    </MemoryRouter>,
  )
}

test('公共额度用完且当前用公共 key(source=server)时,输入框被禁用', () => {
  setup({ model: 'gpt-4o', source: 'server', providerId: 'openai' })

  const input = screen.getByPlaceholderText('次数已用完') as HTMLInputElement
  expect(input.disabled).toBe(true)
})

test('公共额度用完但已切到自带 key(source=user)时,输入框不应被禁用', () => {
  setup({ model: 'gpt-4o', source: 'user', providerId: 'openai' })

  const input = screen.getByPlaceholderText('输入问题,回车发送') as HTMLInputElement
  expect(input.disabled).toBe(false)
})

// ---------- 多版本:一条对话跨版本 ----------

const answer = (version: number): ChatMessage => ({
  role: 'assistant',
  content: '游戏毛利率 61%',
  version,
  sources: [
    { section_title: '2.2 生意特征', section_slug: '22-生意特征', chunk_index: 1 },
    { section_title: '3.1 已删掉的一节', section_slug: '31-已删掉的一节', chunk_index: 5 },
  ],
})

function setupVersioned(messages: ChatMessage[], version: number, slugs: string[], onCite = vi.fn()) {
  mockMessages.mockReturnValue(messages)
  mockUseAuth.mockReturnValue({ user: null, login: vi.fn() })
  mockUseLLMConfig.mockReturnValue({ data: null })
  render(
    <MemoryRouter>
      <ChatPanel docId="doc-1" onCite={onCite} version={version} slugs={new Set(slugs)} />
    </MemoryRouter>,
  )
  return onCite
}

test('回答基于的版本和正在看的不同时,标出「基于 vN」', () => {
  setupVersioned([answer(1)], 2, ['22-生意特征'])
  expect(screen.getByText('基于 v1')).toBeTruthy()
})

test('同一版本的回答不标版本', () => {
  setupVersioned([answer(2)], 2, ['22-生意特征'])
  expect(screen.queryByText(/基于 v/)).toBeNull()
})

test('当前版本里不存在的章节:来源渲染成普通文字,点不了', () => {
  const onCite = setupVersioned([answer(1)], 2, ['22-生意特征'])
  const alive = screen.getByText('来源 §2.2 生意特征')
  const dead = screen.getByText('来源 §3.1 已删掉的一节')
  expect(alive.tagName).toBe('BUTTON')
  expect(dead.tagName).toBe('SPAN')
  fireEvent.click(dead)
  expect(onCite).not.toHaveBeenCalled()
  fireEvent.click(alive)
  expect(onCite).toHaveBeenCalledWith('22-生意特征')
})
