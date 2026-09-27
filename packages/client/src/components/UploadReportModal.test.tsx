import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { UploadReportModal } from './UploadReportModal'
import { stubMatchMedia } from '../test/matchMedia'

const mockUploadDocument = vi.fn()
const mockUploadVersion = vi.fn()
const mockCheckSimilar = vi.fn()
vi.mock('../api', () => ({
  api: {
    uploadDocument: (...args: unknown[]) => mockUploadDocument(...args),
    uploadVersion: (...args: unknown[]) => mockUploadVersion(...args),
    checkSimilar: (...args: unknown[]) => mockCheckSimilar(...args),
  },
}))
beforeEach(() => { mockCheckSimilar.mockResolvedValue({ title: '新研报', candidates: [] }) })
afterEach(() => { mockUploadDocument.mockReset(); mockUploadVersion.mockReset(); mockCheckSimilar.mockReset(); vi.unstubAllGlobals() })

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
  await waitFor(() => expect(ok.disabled).toBe(false))
  expect(mockCheckSimilar).toHaveBeenCalledWith(f)

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
  await waitFor(() => expect(ok.disabled).toBe(false))
  fireEvent.click(ok)
  expect(await screen.findByText('只支持 .md / .markdown / .txt 文件')).toBeTruthy()
  expect(onUploaded).not.toHaveBeenCalled()
})

const OLD = {
  document: {
    id: 'doc_tx', filename: '腾讯生态产业链投资研究报告', size_bytes: 1, chunk_count: 1,
    created_at: '2026-08-01T00:00:00Z', latest_version: 2, updated_at: '2026-09-25T00:00:00Z',
  },
  titleScore: 0.62,
  contentScore: 0.41,
  topicScore: 0.7,
  titleMatch: 'similar' as const,
  contentMatch: true,
  likely: true,
}

test('库里有疑似旧版本:列出来并给出依据,不选就不让传', async () => {
  mockCheckSimilar.mockResolvedValue({ title: '腾讯(Q4 更新)', candidates: [OLD] })
  const { zone, ok } = renderModal()
  fireEvent.drop(zone, dt([md('腾讯Q4.md')]))

  expect(await screen.findByText('库里可能已有这篇的旧版本')).toBeTruthy()
  expect(screen.getByText('作为「腾讯生态产业链投资研究报告」的新版本 v3')).toBeTruthy()
  expect(screen.getByText('标题相近 · 正文重合 41% · 目前 v2,2026/9/25 更新')).toBeTruthy()
  expect(ok.disabled).toBe(true)
  expect(ok.textContent).toBe('请先选择上传方式')
})

test('选「作为新版本」:出现更新说明,按新版本上传到那篇', async () => {
  mockCheckSimilar.mockResolvedValue({ title: '腾讯(Q4 更新)', candidates: [OLD] })
  mockUploadVersion.mockResolvedValue({ version: 3 })
  const { zone, dialog, onUploaded } = renderModal()
  const f = md('腾讯Q4.md')
  fireEvent.drop(zone, dt([f]))

  fireEvent.click(await screen.findByRole('radio', { name: /作为「腾讯生态产业链投资研究报告」的新版本/ }))
  fireEvent.change(screen.getByLabelText('更新说明(可选)'), { target: { value: '加入 Q4 数据' } })
  const ok = within(dialog).getByRole('button', { name: '上传为新版本' }) as HTMLButtonElement
  expect(ok.disabled).toBe(false)
  fireEvent.click(ok)

  await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
  expect(mockUploadVersion).toHaveBeenCalledWith('doc_tx', f, '加入 Q4 数据')
  expect(mockUploadDocument).not.toHaveBeenCalled()
})

test('选「新建一篇」:照常新建,不出更新说明', async () => {
  mockCheckSimilar.mockResolvedValue({ title: '腾讯(Q4 更新)', candidates: [OLD] })
  mockUploadDocument.mockResolvedValue({ id: 'd9' })
  const { zone, ok, onUploaded } = renderModal()
  const f = md('腾讯Q4.md')
  fireEvent.drop(zone, dt([f]))

  fireEvent.click(await screen.findByRole('radio', { name: /新建一篇/ }))
  expect(screen.queryByLabelText('更新说明(可选)')).toBeNull()
  expect(ok.disabled).toBe(false)
  fireEvent.click(ok)

  await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
  expect(mockUploadDocument).toHaveBeenCalledWith(f)
  expect(mockUploadVersion).not.toHaveBeenCalled()
})

test('换了文件:按新文件的查重结果重来,之前的选择作废', async () => {
  mockCheckSimilar.mockResolvedValueOnce({ title: '腾讯', candidates: [OLD] })
  const { zone, ok } = renderModal()
  fireEvent.drop(zone, dt([md('腾讯Q4.md')]))
  fireEvent.click(await screen.findByRole('radio', { name: /新建一篇/ }))

  mockCheckSimilar.mockResolvedValueOnce({ title: '腾讯', candidates: [OLD] })
  fireEvent.drop(zone, dt([md('腾讯Q4-修订.md')]))
  await screen.findByText('已选择:腾讯Q4-修订.md')
  await waitFor(() => expect(mockCheckSimilar).toHaveBeenCalledTimes(2))
  expect(await screen.findByText('库里可能已有这篇的旧版本')).toBeTruthy()
  expect(ok.disabled).toBe(true)
})

test('查重失败:提示一句,仍能新建上传', async () => {
  mockCheckSimilar.mockRejectedValue(new Error('查重失败'))
  mockUploadDocument.mockResolvedValue({ id: 'd9' })
  const { zone, ok, onUploaded } = renderModal()
  fireEvent.drop(zone, dt([md()]))

  expect(await screen.findByText('没能查重,上传会新建一篇。')).toBeTruthy()
  expect(ok.disabled).toBe(false)
  fireEvent.click(ok)
  await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
})

test('没有很可能的旧版本:换个说法列出最相近的几篇,照样要选', async () => {
  const far = (id: string, filename: string, titleScore = 0) => ({
    document: { ...OLD.document, id, filename, latest_version: 1 },
    titleScore, contentScore: 0.02, topicScore: 0.5, titleMatch: null, contentMatch: false, likely: false,
  })
  mockCheckSimilar.mockResolvedValue({
    title: '中海油', candidates: [far('a', '中国海洋石油（CNOOC）产业链投资研究报告', 0.05), far('b', '煤炭'), far('c', '碳酸锂')],
  })
  const { zone, ok } = renderModal()
  fireEvent.drop(zone, dt([md('中海油.md')]))

  expect(await screen.findByText('库里与这篇最相近的研报')).toBeTruthy()
  expect(screen.queryByText('库里可能已有这篇的旧版本')).toBeNull()
  // 没过线的分数不显示,只说是按主题排进来的
  expect(screen.getAllByText('主题相近 · 目前 v1,2026/9/25 更新')).toHaveLength(3)
  expect(screen.getAllByRole('radio')).toHaveLength(4)
  expect(ok.disabled).toBe(true)
})

test('手机:在底部抽屉里选候选、按新版本上传', async () => {
  stubMatchMedia(false)
  mockCheckSimilar.mockResolvedValue({ title: '腾讯(Q4 更新)', candidates: [OLD] })
  mockUploadVersion.mockResolvedValue({ version: 3 })
  const onUploaded = vi.fn()
  render(<UploadReportModal open onClose={vi.fn()} onUploaded={onUploaded} />)
  expect(document.querySelector('.upload-sheet')).not.toBeNull()

  const f = md('腾讯Q4.md')
  fireEvent.drop(screen.getByRole('button', { name: /拖拽文件到此处，或点击选择文件/ }), dt([f]))
  fireEvent.click(await screen.findByRole('radio', { name: /作为「腾讯生态产业链投资研究报告」的新版本/ }))
  fireEvent.click(screen.getByRole('button', { name: '上传为新版本' }))

  await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
  expect(mockUploadVersion).toHaveBeenCalledWith('doc_tx', f, '')
})
