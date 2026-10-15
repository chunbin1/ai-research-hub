import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfirmDelete } from './ConfirmDelete'
import type { Document } from '../types'

const DOC: Document = {
  id: 'd1', filename: '腾讯生态产业链投资研究报告', size_bytes: 1, chunk_count: 47,
  created_at: '2026-08-01T00:00:00.000Z',
}

function renderDelete(onOk: () => Promise<void>) {
  const onCancel = vi.fn()
  render(<ConfirmDelete doc={DOC} onCancel={onCancel} onOk={onOk} />)
  return { onCancel, ok: screen.getByRole('button', { name: '删除' }), cancel: screen.getByRole('button', { name: '取消' }) }
}

test('连点删除只触发一次,进行中取消无效', async () => {
  let finish!: () => void
  const onOk = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const { onCancel, ok, cancel } = renderDelete(onOk)

  fireEvent.click(ok)
  fireEvent.click(ok)
  expect(onOk).toHaveBeenCalledTimes(1)
  expect(ok.className).toContain('ant-btn-loading')
  expect((cancel as HTMLButtonElement).disabled).toBe(true)

  fireEvent.click(cancel)
  expect(onCancel).not.toHaveBeenCalled()

  finish()
  await waitFor(() => expect(ok.className).not.toContain('ant-btn-loading'))
})

test('删除失败留在弹窗里并提示,之后可以再试一次', async () => {
  const onOk = vi.fn()
    .mockRejectedValueOnce(new Error('删除失败'))
    .mockResolvedValueOnce(undefined)
  const { onCancel, ok } = renderDelete(onOk)

  fireEvent.click(ok)
  expect((await screen.findByRole('alert')).textContent).toContain('删除失败')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(onCancel).not.toHaveBeenCalled()
  expect(ok.className).not.toContain('ant-btn-loading')

  fireEvent.click(ok)
  await waitFor(() => expect(onOk).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

test('抛出的不是 Error 时用「删除失败」兜底', async () => {
  renderDelete(() => Promise.reject('nope'))
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  expect((await screen.findByRole('alert')).textContent).toContain('删除失败')
})
