import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReportDropZone } from './ReportDropZone'

const md = (name = '腾讯研报.md') => new File(['# 标题\n'], name, { type: 'text/markdown' })
const pdf = () => new File(['%PDF'], '研报.pdf', { type: 'application/pdf' })
/** happy-dom 的 DataTransfer 塞不进文件,给事件挂一个同形对象 */
const dt = (files: File[]) => ({ dataTransfer: { files, types: ['Files'], dropEffect: 'none' } })
const zone = () => screen.getByRole('button', { name: /拖拽文件到此处，或点击选择文件/ })

test('显示拖拽提示与格式说明', () => {
  render(<ReportDropZone onFile={() => {}} />)
  expect(screen.getByText('拖拽文件到此处，或点击选择文件')).toBeTruthy()
  expect(screen.getByText('支持 .md / .markdown / .txt,不超过 20 MB')).toBeTruthy()
})

test('拖入合法文件:交给 onFile', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} />)
  const f = md()
  fireEvent.dragEnter(zone(), dt([f]))
  fireEvent.dragOver(zone(), dt([f]))
  fireEvent.drop(zone(), dt([f]))
  expect(onFile).toHaveBeenCalledWith(f)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('拖入 PDF:拒收,区域下方提示', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} />)
  fireEvent.drop(zone(), dt([pdf()]))
  expect(onFile).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe('「研报.pdf」格式不支持,只支持 .md / .markdown / .txt 文件')
})

test('超过 20 MB:拒收', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} />)
  const big = md('大.md')
  Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 })
  fireEvent.drop(zone(), dt([big]))
  expect(onFile).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('超过 20 MB')
})

test('一次拖入多个:一个都不收', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} />)
  fireEvent.drop(zone(), dt([md('a.md'), md('b.md')]))
  expect(onFile).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe('一次只能上传一个文件')
})

test('拒收后再选合法文件:错误消失', () => {
  render(<ReportDropZone onFile={() => {}} />)
  fireEvent.drop(zone(), dt([pdf()]))
  expect(screen.getByRole('alert')).toBeTruthy()
  fireEvent.drop(zone(), dt([md()]))
  expect(screen.queryByRole('alert')).toBeNull()
})

test('拖拽高亮:进入亮,经过子元素不闪,离开灭;drop 后熄灭', () => {
  render(<ReportDropZone onFile={() => {}} />)
  const el = zone()
  const child = screen.getByText('支持 .md / .markdown / .txt,不超过 20 MB')
  expect(el.dataset.dragging).toBeUndefined()

  fireEvent.dragEnter(el, dt([]))
  expect(el.dataset.dragging).toBe('true')
  expect(screen.getByText('松开即可选择这个文件')).toBeTruthy()

  fireEvent.dragEnter(child, dt([]))
  fireEvent.dragLeave(el, dt([]))
  expect(el.dataset.dragging).toBe('true')
  fireEvent.dragLeave(child, dt([]))
  expect(el.dataset.dragging).toBeUndefined()

  fireEvent.dragEnter(el, dt([md()]))
  fireEvent.drop(el, dt([md()]))
  expect(el.dataset.dragging).toBeUndefined()
})

test('拖进来的不是文件(如选中的文字):不高亮', () => {
  render(<ReportDropZone onFile={() => {}} />)
  fireEvent.dragEnter(zone(), { dataTransfer: { files: [], types: ['text/plain'] } })
  expect(zone().dataset.dragging).toBeUndefined()
})

test('点击区域打开文件框,选中的文件走同一套校验', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} />)
  const input = screen.getByTestId('report-file-input') as HTMLInputElement
  expect(input.accept).toBe('.md,.markdown,.txt')
  const clickSpy = vi.spyOn(input, 'click')
  fireEvent.click(zone())
  expect(clickSpy).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(zone(), { key: 'Enter' })
  expect(clickSpy).toHaveBeenCalledTimes(2)

  const ok = md()
  fireEvent.change(input, { target: { files: [ok] } })
  expect(onFile).toHaveBeenCalledWith(ok)
  fireEvent.change(input, { target: { files: [new File(['x'], 'bad.docx')] } })
  expect(onFile).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alert').textContent).toContain('格式不支持')
})

test('显示已选文件名', () => {
  render(<ReportDropZone onFile={() => {}} selectedName="腾讯研报.md" />)
  expect(screen.getByText('已选择:腾讯研报.md')).toBeTruthy()
})

test('禁用时:不高亮、drop 不收、点击不开文件框', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} disabled />)
  const input = screen.getByTestId('report-file-input') as HTMLInputElement
  const clickSpy = vi.spyOn(input, 'click')
  fireEvent.dragEnter(zone(), dt([md()]))
  expect(zone().dataset.dragging).toBeUndefined()
  fireEvent.drop(zone(), dt([md()]))
  fireEvent.click(zone())
  expect(onFile).not.toHaveBeenCalled()
  expect(clickSpy).not.toHaveBeenCalled()
})
