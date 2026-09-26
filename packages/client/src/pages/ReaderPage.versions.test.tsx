import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { stubMatchMedia } from '../test/matchMedia'
import ReaderPage from './ReaderPage'
import type { DocumentVersion } from '../types'

// ChatPanel 换成把收到的 props 写出来的替身:这里只测 ReaderPage 传了什么。
vi.mock('../components/ChatPanel', () => ({
  default: ({ version, slugs }: { version?: number; slugs?: Set<string> }) => (
    <div data-testid="chat">v={String(version)} slugs={[...(slugs ?? [])].join(',')}</div>
  ),
}))

const mockGetDocument = vi.fn()
vi.mock('../api', () => ({
  api: { getDocument: (...args: unknown[]) => mockGetDocument(...args) },
}))

const ver = (version: number, note: string | null = null): DocumentVersion => ({
  doc_id: 'doc-1', version, filename: `报告 v${version}`, size_bytes: 1, chunk_count: 1, note,
  created_at: `2026-0${version}-01T00:00:00.000Z`,
})

function serve(versions: DocumentVersion[]) {
  mockGetDocument.mockImplementation(async (_id: string, v?: number) => {
    const version = v ?? versions[versions.length - 1].version
    return {
      document: { filename: '报告' },
      markdown: `# 报告 v${version}\n\n## 第${version}节\n\n正文`,
      version,
      versions,
    }
  })
}

function renderReader(url = '/reports/doc-1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/reports/:id" element={<ReaderPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockGetDocument.mockReset()
  Element.prototype.scrollTo = vi.fn()
  stubMatchMedia(true)
})

describe('ReaderPage — 版本', () => {
  it('只有一个版本时版本号是静态标签,没有下拉', async () => {
    serve([ver(1)])
    renderReader()
    await waitFor(() => expect(screen.getByTestId('chat').textContent).toContain('v=1'))
    expect(screen.queryByLabelText('选择版本')).toBeNull()
    expect(screen.getAllByText('v1').length).toBeGreaterThan(0)
    // 只有一版时「最新」标记没有信息量,不出
    expect(screen.queryByText('最新')).toBeNull()
  })

  it('默认打开最新版,不显示「正在查看旧版」', async () => {
    serve([ver(1), ver(2, '加入 Q3 数据')])
    renderReader()
    await waitFor(() => expect(screen.getByTestId('chat').textContent).toContain('v=2'))
    expect(mockGetDocument).toHaveBeenCalledWith('doc-1', undefined)
    expect(screen.queryByRole('status')).toBeNull()
    // 更新说明在版本下拉里
    fireEvent.click(screen.getAllByLabelText('选择版本')[0])
    expect(screen.getByText('加入 Q3 数据')).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { checked: true }).textContent).toContain('v2')
  })

  it('从版本下拉切到旧版', async () => {
    serve([ver(1), ver(2)])
    renderReader()
    await waitFor(() => expect(screen.getByTestId('chat').textContent).toContain('v=2'))
    fireEvent.click(screen.getAllByLabelText('选择版本')[0])
    fireEvent.click(screen.getByRole('menuitemradio', { name: /v1/ }))
    await waitFor(() => expect(screen.getByTestId('chat').textContent).toContain('v=1'))
    expect(mockGetDocument).toHaveBeenLastCalledWith('doc-1', 1)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('?v=1 打开旧版:显示提示条,问答针对 v1,锚点用 v1 的', async () => {
    serve([ver(1), ver(2, '加入 Q3 数据')])
    renderReader('/reports/doc-1?v=1')
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('正在查看历史版本 v1'))
    expect(mockGetDocument).toHaveBeenCalledWith('doc-1', 1)
    expect(screen.getByRole('status').textContent).toContain('切换到最新版 v2')
    const chat = screen.getByTestId('chat').textContent!
    expect(chat).toContain('v=1')
    expect(chat).toContain('第1节')
    expect(chat).not.toContain('第2节')
  })

  it('点提示条上的「切换到最新版」回到最新版', async () => {
    serve([ver(1), ver(2)])
    renderReader('/reports/doc-1?v=1')
    await waitFor(() => screen.getByRole('status'))
    fireEvent.click(within(screen.getByRole('status')).getByRole('button'))
    await waitFor(() => expect(screen.getByTestId('chat').textContent).toContain('v=2'))
    expect(screen.queryByRole('status')).toBeNull()
    expect(mockGetDocument).toHaveBeenLastCalledWith('doc-1', undefined)
  })

  it('标题跟着所看的版本走', async () => {
    serve([ver(1), ver(2)])
    renderReader('/reports/doc-1?v=1')
    await waitFor(() => expect(document.title).toBe('报告 v1 — 研报站'))
  })
})
