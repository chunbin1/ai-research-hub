import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import VersionDiffPage from './VersionDiffPage'
import type { DocumentVersion } from '../types'

const mockGetDocument = vi.fn()
vi.mock('../api', () => ({
  api: { getDocument: (...args: unknown[]) => mockGetDocument(...args) },
}))

const ver = (version: number, note: string | null = null): DocumentVersion => ({
  doc_id: 'doc-1', version, filename: `报告 v${version}`, size_bytes: 1, chunk_count: 1, note,
  created_at: `2026-0${version}-01T00:00:00.000Z`,
})

const versions = [ver(1), ver(2, '上调目标价'), ver(3, '补充风险')]
const bodies: Record<number, string> = {
  1: '# 报告\n\n## 结论\n\n目标价 100 元。\n\n## 风险\n\n原材料涨价。',
  2: '# 报告\n\n## 结论\n\n目标价 120 元。\n\n## 风险\n\n原材料涨价。',
  3: '# 报告\n\n## 结论\n\n目标价 120 元。\n\n## 风险\n\n原材料涨价。\n\n汇率波动。',
}

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.search}</div>
}

function renderDiff(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/reports/:id/diff" element={<><VersionDiffPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockGetDocument.mockReset()
  mockGetDocument.mockImplementation(async (_id: string, v?: number) => {
    const version = v ?? 3
    return { document: { filename: '报告' }, markdown: bodies[version], version, versions }
  })
})

describe('VersionDiffPage', () => {
  it('不带参数时比最新版和上一版', async () => {
    renderDiff('/reports/doc-1/diff')
    await waitFor(() => expect(screen.getByLabelText('改动统计')).toBeTruthy())
    expect(mockGetDocument).toHaveBeenCalledWith('doc-1', undefined)
    expect(mockGetDocument).toHaveBeenCalledWith('doc-1', 2)
    expect(screen.getByLabelText('改动统计').textContent).toContain('+1 行')
    expect(screen.getByText('汇率波动。')).toBeTruthy()
    // 更新说明只列 v2 → v3 之间的
    expect(screen.getByText('补充风险')).toBeTruthy()
    expect(screen.queryByText('上调目标价')).toBeNull()
  })

  it('行内标出改了的数字,改动的章节可点', async () => {
    renderDiff('/reports/doc-1/diff?from=1&to=2')
    await waitFor(() => expect(screen.getByLabelText('改动统计')).toBeTruthy())
    expect(screen.getByText('100', { selector: 'del' })).toBeTruthy()
    expect(screen.getByText('120', { selector: 'ins' })).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: '改动的章节' })
    expect(nav.textContent).toContain('结论')
    expect(nav.textContent).not.toContain('风险')
  })

  it('换版本写回 URL', async () => {
    renderDiff('/reports/doc-1/diff?from=1&to=2')
    await waitFor(() => expect(screen.getByLabelText('改动统计')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('新版'), { target: { value: '3' } })
    expect(screen.getByTestId('loc').textContent).toBe('?from=1&to=3')
    fireEvent.click(screen.getByLabelText('交换新旧版'))
    expect(screen.getByTestId('loc').textContent).toBe('?from=3&to=1')
  })

  it('同一版本、没有区别都给出说明', async () => {
    renderDiff('/reports/doc-1/diff?from=2&to=2')
    await waitFor(() => expect(screen.getByText(/同一个版本/)).toBeTruthy())
    expect(mockGetDocument).toHaveBeenCalledTimes(1)
  })

  it('版本不存在时显示错误', async () => {
    mockGetDocument.mockRejectedValueOnce(new Error('没有 v9 这个版本'))
    renderDiff('/reports/doc-1/diff?from=1&to=9')
    await waitFor(() => expect(screen.getByText('没有 v9 这个版本')).toBeTruthy())
  })
})
