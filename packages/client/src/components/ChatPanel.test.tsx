import { test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ChatPanel from './ChatPanel'
import type { AuthUser } from '../hooks/useAuth'
import type { LLMEffective } from '../types'

// outOfQuota 门槛测试只关心 useAuth / useLLMConfig / useDocChat 返回的数据形状,
// 三个 hook 全部替身掉,避免真实拉取网络请求。
const mockUseAuth = vi.fn()
const mockUseLLMConfig = vi.fn()

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))
vi.mock('../hooks/useLLMConfig', () => ({
  useLLMConfig: () => mockUseLLMConfig(),
}))
vi.mock('../hooks/useDocChat', () => ({
  useDocChat: () => ({ messages: [], send: vi.fn(), streaming: false }),
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
