import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { stubMatchMedia } from '../test/matchMedia'
import ReaderPage from './ReaderPage'

// ChatPanel 真身依赖 SSE / fetch,这里换成只暴露一个「来源」按钮的替身,
// 测的是 ReaderPage 自己的溯源回链行为,不是 ChatPanel 内部。
vi.mock('../components/ChatPanel', () => ({
  default: ({ onCite }: { onCite: (slug: string) => void }) => (
    <button onClick={() => onCite('第一节')}>来源 §第一节</button>
  ),
}))

vi.mock('../api', () => ({
  api: {
    getDocument: vi.fn().mockResolvedValue({
      document: { filename: '某公司深度报告.md' },
      markdown: '# 标题\n\n## 第一节\n\n正文内容',
    }),
  },
}))

function renderReader() {
  return render(
    <MemoryRouter initialEntries={['/reports/doc-1']}>
      <Routes>
        <Route path="/reports/:id" element={<ReaderPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** toggle 按钮的展开态:靠 aria-controls 定位,不依赖文案 */
function chatToggle(): HTMLElement {
  const btn = document.querySelector('button[aria-controls="chat-panel"]')
  if (!btn) throw new Error('找不到问答栏 toggle 按钮')
  return btn as HTMLElement
}
function chatExpanded(): string | null {
  return chatToggle().getAttribute('aria-expanded')
}

const originalScrollTo = Element.prototype.scrollTo

beforeEach(() => {
  localStorage.clear()
  // happy-dom 没实现元素级 scrollTo,补一个 spy
  Element.prototype.scrollTo = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.style.overflow = ''
  Element.prototype.scrollTo = originalScrollTo
})

describe('ReaderPage — 问答栏初始状态', () => {
  it('桌面端默认展开', async () => {
    stubMatchMedia(true)
    renderReader()
    await waitFor(() => expect(chatExpanded()).toBe('true'))
  })

  it('桌面端沿用 localStorage 的收起状态', async () => {
    localStorage.setItem('reader.chatOpen', '0')
    stubMatchMedia(true)
    renderReader()
    await waitFor(() => expect(chatExpanded()).toBe('false'))
  })

  it('移动端恒为收起,且忽略 localStorage', async () => {
    localStorage.setItem('reader.chatOpen', '1')
    stubMatchMedia(false)
    renderReader()
    await waitFor(() => expect(chatExpanded()).toBe('false'))
  })
})

describe('ReaderPage — 点来源 chip 的溯源回链', () => {
  it('移动端:先收起问答面板,再滚动到章节', async () => {
    stubMatchMedia(false)
    const { getByText } = renderReader()
    await waitFor(() => expect(chatExpanded()).toBe('false'))

    // 先展开面板
    chatToggle().click()
    await waitFor(() => expect(chatExpanded()).toBe('true'))

    getByText('来源 §第一节').click()

    await waitFor(() => expect(chatExpanded()).toBe('false'))
    expect(Element.prototype.scrollTo).toHaveBeenCalled()

    const sheet = document.querySelector('#chat-panel')
    expect(sheet?.className).toContain('translate-y-full')
  })

  it('移动端:收面板不写 localStorage', async () => {
    stubMatchMedia(false)
    const { getByText } = renderReader()
    await waitFor(() => expect(chatExpanded()).toBe('false'))

    chatToggle().click()
    getByText('来源 §第一节').click()

    await waitFor(() => expect(chatExpanded()).toBe('false'))
    expect(localStorage.getItem('reader.chatOpen')).toBeNull()
  })

  it('桌面端:点来源后面板保持展开', async () => {
    stubMatchMedia(true)
    const { getByText } = renderReader()
    await waitFor(() => expect(chatExpanded()).toBe('true'))

    getByText('来源 §第一节').click()

    expect(chatExpanded()).toBe('true')
    expect(Element.prototype.scrollTo).toHaveBeenCalled()
  })

  it('桌面端:手动收起会写进 localStorage', async () => {
    stubMatchMedia(true)
    renderReader()
    await waitFor(() => expect(chatExpanded()).toBe('true'))

    chatToggle().click()

    await waitFor(() => expect(localStorage.getItem('reader.chatOpen')).toBe('0'))
  })
})

describe('ReaderPage — 目录抽屉', () => {
  it('移动端打开抽屉时锁住 body 滚动,关闭后解锁', async () => {
    stubMatchMedia(false)
    renderReader()
    const menu = await screen.findByLabelText('打开目录')

    menu.click()
    await waitFor(() => expect(document.body.style.overflow).toBe('hidden'))

    const mask = document.querySelector('[data-testid="toc-mask"]')
    expect(mask).toBeTruthy()
    ;(mask as HTMLElement).click()
    await waitFor(() => expect(document.body.style.overflow).toBe(''))
  })
})
