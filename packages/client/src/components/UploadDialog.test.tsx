import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { stubMatchMedia } from '../test/matchMedia'
import { UploadDialog } from './UploadDialog'

afterEach(() => { vi.unstubAllGlobals() })

function renderDialog(props: Partial<Parameters<typeof UploadDialog>[0]> = {}) {
  const onOk = vi.fn()
  const onCancel = vi.fn()
  render(
    <UploadDialog open title="上传研报" okText="上传" okDisabled={false} onOk={onOk} onCancel={onCancel} {...props}>
      <p>内容</p>
    </UploadDialog>,
  )
  return { onOk, onCancel }
}

test('桌面:居中弹窗', () => {
  stubMatchMedia(true)
  renderDialog()
  expect(document.querySelector('.ant-modal')).not.toBeNull()
  expect(document.querySelector('.upload-sheet')).toBeNull()
})

test('手机:底部抽屉,底部按钮与右上角关闭都能用', () => {
  stubMatchMedia(false)
  const { onOk, onCancel } = renderDialog()
  expect(document.querySelector('.ant-modal')).toBeNull()
  expect(document.querySelector('.upload-sheet')).not.toBeNull()
  expect(screen.getByText('上传研报')).toBeTruthy()
  expect(screen.getByText('内容')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '上传' }))
  expect(onOk).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(onCancel).toHaveBeenCalledTimes(2)
})

test('手机:不可点时按钮真的 disabled', () => {
  stubMatchMedia(false)
  const { onOk } = renderDialog({ okDisabled: true, cancelDisabled: true })
  const ok = screen.getByRole('button', { name: '上传' }) as HTMLButtonElement
  expect(ok.disabled).toBe(true)
  expect((screen.getByRole('button', { name: '关闭' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(ok)
  expect(onOk).not.toHaveBeenCalled()
})
