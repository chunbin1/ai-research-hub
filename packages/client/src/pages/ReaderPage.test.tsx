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

// 面板 / 抽屉是否处于打开态。
//
// 没用 `.ant-drawer-section`(对话框面板本身):实测下来 @rc-component/drawer
// 的退场动画是 removeOnLeave:false——面板一旦打开过,这个节点就常驻 DOM,关闭时
// 只是给外层 wrapper 挂 `-hidden` 类(display:none),并不会整块摘掉。而
// `-hidden` 类本身要等 transitionend 才会挂上,happy-dom 不会真的跑 CSS 过渡、
// 不会派发 transitionend,所以等它俩必然超时——这是本文件最初版本踩出来的坑。
//
// 改用根节点的 `ant-drawer-open` 类:它由 `open` prop 直接同步驱动(见
// DrawerPopup 源码 `[prefixCls-open]: open`),不经过任何过渡动画,状态变化后
// 立刻反映,測 happy-dom 环境下稳定可靠。这也是 Drawer 关闭时「不在 tab 序 /
// 无障碍树中」的真正机制——不是把节点摘掉,是 display:none。
function chatDrawerOpen(): boolean {
  return !!document.querySelector('.reader-chat-drawer.ant-drawer-open')
}
function tocDrawerOpen(): boolean {
  return !!document.querySelector('.reader-toc-drawer.ant-drawer-open')
}

const originalScrollTo = Element.prototype.scrollTo

beforeEach(() => {
  localStorage.clear()
  // happy-dom 没实现元素级 scrollTo,补一个 spy
  Element.prototype.scrollTo = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
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
    // 冷启动收起态:问答 Drawer 从未打开过,连根节点都不会挂载
    expect(chatDrawerOpen()).toBe(false)
    expect(document.querySelector('.reader-chat-drawer')).toBeFalsy()
  })
})

describe('ReaderPage — 点来源 chip 的溯源回链', () => {
  it('移动端:先收起问答面板,再滚动到章节', async () => {
    stubMatchMedia(false)
    const { findByText } = renderReader()
    await waitFor(() => expect(chatExpanded()).toBe('false'))

    // 先展开面板
    chatToggle().click()
    await waitFor(() => expect(chatExpanded()).toBe('true'))
    await waitFor(() => expect(chatDrawerOpen()).toBe(true))

    ;(await findByText('来源 §第一节')).click()

    await waitFor(() => expect(chatExpanded()).toBe('false'))
    expect(Element.prototype.scrollTo).toHaveBeenCalled()
    await waitFor(() => expect(chatDrawerOpen()).toBe(false))
  })

  it('移动端:收面板不写 localStorage', async () => {
    stubMatchMedia(false)
    const { findByText } = renderReader()
    await waitFor(() => expect(chatExpanded()).toBe('false'))

    chatToggle().click()
    await waitFor(() => expect(chatDrawerOpen()).toBe(true))
    ;(await findByText('来源 §第一节')).click()

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
  it('移动端打开抽屉:遮罩存在,点遮罩关闭后抽屉恢复收起', async () => {
    stubMatchMedia(false)
    renderReader()
    const menu = await screen.findByLabelText('打开目录')

    menu.click()
    await waitFor(() => expect(tocDrawerOpen()).toBe(true))

    const mask = document.querySelector('.reader-toc-drawer .ant-drawer-mask')
    expect(mask).toBeTruthy()

    ;(mask as HTMLElement).click()
    await waitFor(() => expect(tocDrawerOpen()).toBe(false))
  })

  // 上一轮的真实 bug:目录抽屉与问答面板都是覆盖式浮层,同时打开会导致遮罩点不掉、
  // 页面卡死。改用 Drawer 之后仍要显式保证二者互斥。
  it('移动端:打开目录抽屉后再打开问答面板,目录抽屉应随之关闭', async () => {
    stubMatchMedia(false)
    renderReader()
    const menu = await screen.findByLabelText('打开目录')

    menu.click()
    await waitFor(() => expect(tocDrawerOpen()).toBe(true))

    chatToggle().click()

    await waitFor(() => expect(chatDrawerOpen()).toBe(true))
    await waitFor(() => expect(tocDrawerOpen()).toBe(false))
  })
})
