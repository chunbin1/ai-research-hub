import { test, expect } from 'vitest'
import { render } from '@testing-library/react'
import { useWindowDropGuard } from './useFileDrop'

function Guarded() { useWindowDropGuard(); return null }

function dispatch(type: string, types: string[]) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'dataTransfer', { value: { types, files: [] } })
  window.dispatchEvent(e)
  return e
}

test('文件没拖到拖拽区就松手:拦掉浏览器默认的「打开文件」', () => {
  const { unmount } = render(<Guarded />)
  expect(dispatch('dragover', ['Files']).defaultPrevented).toBe(true)
  expect(dispatch('drop', ['Files']).defaultPrevented).toBe(true)
  // 拖的不是文件(比如一段文字)不管
  expect(dispatch('drop', ['text/plain']).defaultPrevented).toBe(false)
  unmount()
  expect(dispatch('drop', ['Files']).defaultPrevented).toBe(false)
})
