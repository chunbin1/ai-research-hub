import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReportDropZone } from './ReportDropZone'

function file(name: string, size = 10, type = 'text/markdown') {
  const f = new File(['# 标题\n'], name, { type })
  if (size !== 10) Object.defineProperty(f, 'size', { value: size })
  return f
}

/** happy-dom 的 DataTransfer 不能塞文件,直接给事件挂一个同形对象 */
function dt(files: File[]) {
  return { dataTransfer: { files, types: ['Files'], dropEffect: 'none' } }
}

function zone() {
  return screen.getByRole('button', { name: /拖拽文件到此处，或点击选择/ })
}

test('显示拖拽提示', () => {
  render(<ReportDropZone onFile={() => {}} />)
  expect(screen.getByText('拖拽文件到此处，或点击选择')).toBeTruthy()
  expect(screen.getByText(/支持 \.md \/ \.markdown \/ \.txt/)).toBeTruthy()
})

test('拖入合法文件:交给 onFile', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} />)
  const f = file('腾讯研报.md')
  fireEvent.dragEnter(zone(), dt([f]))
  fireEvent.dragOver(zone(), dt([f]))
  fireEvent.drop(zone(), dt([f]))
  expect(onFile).toHaveBeenCalledTimes(1)
  expect(onFile).toHaveBeenCalledWith(f)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('拖入不支持的格式:拒收并提示', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} />)
  fireEvent.drop(zone(), dt([file('研报.pdf', 10, 'application/pdf')]))
  expect(onFile).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('只支持 .md / .markdown / .txt')
})

test('超过 20 MB:拒收并提示', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} />)
  fireEvent.drop(zone(), dt([file('大文件.md', 20 * 1024 * 1024 + 1)]))
  expect(onFile).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('超过 20 MB')
})

test('一次拖入多个:一个都不收', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} />)
  fireEvent.drop(zone(), dt([file('a.md'), file('b.md')]))
  expect(onFile).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe('一次只能上传一个文件')
})

test('拒收后再拖入合法文件:错误消失', () => {
  render(<ReportDropZone onFile={() => {}} />)
  fireEvent.drop(zone(), dt([file('x.pdf')]))
  expect(screen.getByRole('alert')).toBeTruthy()
  fireEvent.drop(zone(), dt([file('x.md')]))
  expect(screen.queryByRole('alert')).toBeNull()
})

test('拖拽悬停高亮:进入亮、离开灭,经过子元素不闪', () => {
  render(<ReportDropZone onFile={() => {}} />)
  const el = zone()
  const child = screen.getByText('拖拽文件到此处，或点击选择')
  expect(el.dataset.dragging).toBeUndefined()

  fireEvent.dragEnter(el, dt([]))
  expect(el.dataset.dragging).toBe('true')
  expect(screen.getByText('松开即可上传')).toBeTruthy()

  // 移到子元素上:先 enter 子元素、再 leave 容器 —— 仍然高亮
  fireEvent.dragEnter(child, dt([]))
  fireEvent.dragLeave(el, dt([]))
  expect(el.dataset.dragging).toBe('true')

  // 离开子元素、再离开容器:层数归零才熄灭
  fireEvent.dragLeave(child, dt([]))
  expect(el.dataset.dragging).toBeUndefined()
})

test('drop 之后高亮熄灭', () => {
  render(<ReportDropZone onFile={() => {}} />)
  fireEvent.dragEnter(zone(), dt([file('a.md')]))
  expect(zone().dataset.dragging).toBe('true')
  fireEvent.drop(zone(), dt([file('a.md')]))
  expect(zone().dataset.dragging).toBeUndefined()
})

test('拖进来的不是文件(如选中的文字):不高亮', () => {
  render(<ReportDropZone onFile={() => {}} />)
  fireEvent.dragEnter(zone(), { dataTransfer: { files: [], types: ['text/plain'] } })
  expect(zone().dataset.dragging).toBeUndefined()
})

test('禁用时:不高亮、drop 不收', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} disabled />)
  fireEvent.dragEnter(zone(), dt([file('a.md')]))
  expect(zone().dataset.dragging).toBeUndefined()
  fireEvent.drop(zone(), dt([file('a.md')]))
  expect(onFile).not.toHaveBeenCalled()
})

test('点击仍能选择文件,且走同一套校验', () => {
  const onFile = vi.fn()
  render(<ReportDropZone onFile={onFile} />)
  const input = screen.getByTestId('report-file-input') as HTMLInputElement
  const clickSpy = vi.spyOn(input, 'click')
  fireEvent.click(zone())
  expect(clickSpy).toHaveBeenCalledTimes(1)

  const ok = file('ok.md')
  fireEvent.change(input, { target: { files: [ok] } })
  expect(onFile).toHaveBeenCalledWith(ok)

  fireEvent.change(input, { target: { files: [file('bad.docx')] } })
  expect(onFile).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alert').textContent).toContain('格式不支持')
})
