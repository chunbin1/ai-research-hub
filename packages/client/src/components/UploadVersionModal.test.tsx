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

function renderModal(props: Partial<Parameters<typeof UploadVersionModal>[0]> = {}) {
  const onUploaded = vi.fn()
  render(<UploadVersionModal doc={DOC} onClose={() => {}} onUploaded={onUploaded} {...props} />)
  return { onUploaded, area: screen.getByTestId('version-drop-area') }
}

test('选择按钮提示可以拖拽', () => {
  renderModal()
  expect(screen.getByRole('button', { name: /选择文件\(\.md \/ \.markdown \/ \.txt\),或拖拽到此处/ })).toBeTruthy()
})

test('拖入弹窗:选中文件,点「上传」走 uploadVersion', async () => {
  mockUploadVersion.mockResolvedValue({})
  const { onUploaded, area } = renderModal()
  const f = md()
  fireEvent.dragEnter(area, dt([f]))
  fireEvent.drop(area, dt([f]))
  expect(screen.getByRole('button', { name: /腾讯 v2\.md/ })).toBeTruthy()

  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: '上传' }))
  await waitFor(() => expect(onUploaded).toHaveBeenCalled())
  expect(mockUploadVersion).toHaveBeenCalledWith('d1', f, '')
})

test('拖入 PDF:拒收并提示,「上传」仍不可点', () => {
  const { area } = renderModal()
  fireEvent.drop(area, dt([new File(['%PDF'], '研报.pdf', { type: 'application/pdf' })]))
  expect(screen.getByText(/「研报\.pdf」格式不支持/)).toBeTruthy()
  const ok = within(screen.getByRole('dialog')).getByRole('button', { name: '上传' }) as HTMLButtonElement
  expect(ok.disabled).toBe(true)
})

test('超过 20 MB / 多个文件:都拒收', () => {
  const { area } = renderModal()
  const big = md('大.md')
  Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 })
  fireEvent.drop(area, dt([big]))
  expect(screen.getByText(/超过 20 MB/)).toBeTruthy()
  fireEvent.drop(area, dt([md('a.md'), md('b.md')]))
  expect(screen.getByText('一次只能上传一个文件')).toBeTruthy()
})

test('拖拽高亮:进入亮、经过子元素不闪、离开灭', () => {
  const { area } = renderModal()
  const child = screen.getByText('更新说明(可选)')
  fireEvent.dragEnter(area, dt([]))
  expect(area.dataset.dragging).toBe('true')
  expect(screen.getByText('松开即可选择这个文件')).toBeTruthy()
  fireEvent.dragEnter(child, dt([]))
  fireEvent.dragLeave(area, dt([]))
  expect(area.dataset.dragging).toBe('true')
  fireEvent.dragLeave(child, dt([]))
  expect(area.dataset.dragging).toBeUndefined()
})

test('从研报行拖进来打开时:文件已预选', () => {
  renderModal({ initialFile: md('预选.md') })
  expect(screen.getByRole('button', { name: /预选\.md/ })).toBeTruthy()
})
