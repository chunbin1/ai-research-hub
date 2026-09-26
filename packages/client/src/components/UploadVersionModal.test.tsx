import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { UploadVersionModal } from './UploadVersionModal'
import type { Document } from '../types'

const mockUploadVersion = vi.fn()
vi.mock('../api', () => ({
  api: { uploadVersion: (...args: unknown[]) => mockUploadVersion(...args) },
}))
afterEach(() => { mockUploadVersion.mockReset() })

const DOC: Document = {
  id: 'd1', filename: '腾讯生态产业链投资研究报告', size_bytes: 1, chunk_count: 47,
  created_at: '2026-08-01T00:00:00.000Z', latest_version: 1,
}
const md = (name = '腾讯 v2.md') => new File(['# v2\n'], name, { type: 'text/markdown' })
const dt = (files: File[]) => ({ dataTransfer: { files, types: ['Files'], dropEffect: 'none' } })

function renderModal() {
  const onUploaded = vi.fn()
  render(<UploadVersionModal doc={DOC} onClose={() => {}} onUploaded={onUploaded} />)
  const dialog = screen.getByRole('dialog')
  return {
    onUploaded, dialog,
    zone: within(dialog).getByRole('button', { name: /拖拽文件到此处，或点击选择文件/ }),
    ok: within(dialog).getByRole('button', { name: '上传' }) as HTMLButtonElement,
  }
}

test('用与「上传研报」相同的大拖拽区,更新说明仍在', () => {
  const { dialog } = renderModal()
  expect(within(dialog).getByText('上传新版本 v2')).toBeTruthy()
  expect(within(dialog).getByTestId('report-file-input')).toBeTruthy()
  expect(within(dialog).getByLabelText('更新说明(可选)')).toBeTruthy()
})

test('拖入 → 选中 → 写说明 → 点「上传」走 uploadVersion', async () => {
  mockUploadVersion.mockResolvedValue({})
  const { zone, ok, onUploaded, dialog } = renderModal()
  const f = md()
  fireEvent.drop(zone, dt([f]))
  expect(screen.getByText('已选择:腾讯 v2.md')).toBeTruthy()
  fireEvent.change(within(dialog).getByLabelText('更新说明(可选)'), { target: { value: '加入 Q3 数据' } })
  fireEvent.click(ok)
  await waitFor(() => expect(onUploaded).toHaveBeenCalled())
  expect(mockUploadVersion).toHaveBeenCalledWith('d1', f, '加入 Q3 数据')
})

test('拖入 PDF:拒收,「上传」仍不可点', () => {
  const { zone, ok } = renderModal()
  fireEvent.drop(zone, dt([new File(['%PDF'], '研报.pdf', { type: 'application/pdf' })]))
  expect(screen.getByRole('alert').textContent).toContain('「研报.pdf」格式不支持')
  expect(ok.disabled).toBe(true)
})

test('拖拽高亮', () => {
  const { zone } = renderModal()
  fireEvent.dragEnter(zone, dt([]))
  expect(zone.dataset.dragging).toBe('true')
  fireEvent.dragLeave(zone, dt([]))
  expect(zone.dataset.dragging).toBeUndefined()
})
