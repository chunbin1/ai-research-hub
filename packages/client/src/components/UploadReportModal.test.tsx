import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { UploadReportModal } from './UploadReportModal'

const mockUploadDocument = vi.fn()
vi.mock('../api', () => ({
  api: { uploadDocument: (...args: unknown[]) => mockUploadDocument(...args) },
}))
afterEach(() => { mockUploadDocument.mockReset() })

const md = (name = '新研报.md') => new File(['# 新研报\n'], name, { type: 'text/markdown' })
const dt = (files: File[]) => ({ dataTransfer: { files, types: ['Files'], dropEffect: 'none' } })

function renderModal() {
  const onUploaded = vi.fn()
  const onClose = vi.fn()
  render(<UploadReportModal open onClose={onClose} onUploaded={onUploaded} />)
  const dialog = screen.getByRole('dialog')
  return {
    onUploaded, onClose, dialog,
    zone: within(dialog).getByRole('button', { name: /拖拽文件到此处，或点击选择文件/ }),
    ok: within(dialog).getByRole('button', { name: '上传' }) as HTMLButtonElement,
  }
}

test('标题与大拖拽区;没选文件时「上传」不可点', () => {
  const { dialog, ok } = renderModal()
  expect(within(dialog).getByText('上传研报')).toBeTruthy()
  expect(ok.disabled).toBe(true)
})

test('拖入 .md → 显示文件名 → 点「上传」调用 uploadDocument 并通知刷新', async () => {
  mockUploadDocument.mockResolvedValue({ id: 'd9' })
  const { zone, ok, onUploaded } = renderModal()
  const f = md()
  fireEvent.drop(zone, dt([f]))
  expect(screen.getByText('已选择:新研报.md')).toBeTruthy()
  expect(ok.disabled).toBe(false)

  fireEvent.click(ok)
  await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
  expect(mockUploadDocument).toHaveBeenCalledWith(f)
})

test('拖入 PDF:拒收并提示,「上传」仍不可点,不发请求', () => {
  const { zone, ok } = renderModal()
  fireEvent.drop(zone, dt([new File(['%PDF'], '研报.pdf', { type: 'application/pdf' })]))
  expect(screen.getByRole('alert').textContent).toContain('「研报.pdf」格式不支持')
  expect(ok.disabled).toBe(true)
  expect(mockUploadDocument).not.toHaveBeenCalled()
})

test('服务端报错:弹窗不关,显示错误', async () => {
  mockUploadDocument.mockRejectedValue(new Error('只支持 .md / .markdown / .txt 文件'))
  const { zone, ok, onUploaded } = renderModal()
  fireEvent.drop(zone, dt([md()]))
  fireEvent.click(ok)
  expect(await screen.findByText('只支持 .md / .markdown / .txt 文件')).toBeTruthy()
  expect(onUploaded).not.toHaveBeenCalled()
})
