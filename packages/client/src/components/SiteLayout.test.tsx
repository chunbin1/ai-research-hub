import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SiteLayout } from './SiteLayout'

afterEach(() => { vi.unstubAllGlobals() })

function renderAt(path: string) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null }) as Response))
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<p>研报列表</p>} />
          <Route path="/reports/:id" element={<p>阅读页</p>} />
          <Route path="/signals" element={<p>信号列表</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

/** 桌面栏目行里的某一项(移动端那一行也有同名链接,取第一个即桌面行) */
const tab = (name: string) => screen.getAllByRole('link', { name })[0]

// 以前每页各挂一个顶栏,切栏目时整条顶栏卸载重建 —— 看起来就是一闪
test('切栏目时顶栏是同一个节点,不重建', () => {
  renderAt('/')
  const header = document.querySelector('header')
  expect(tab('研报').getAttribute('aria-current')).toBe('page')

  fireEvent.click(tab('信号'))

  expect(screen.getByText('信号列表')).toBeTruthy()
  expect(document.querySelector('header')).toBe(header)
  expect(tab('信号').getAttribute('aria-current')).toBe('page')
  expect(tab('研报').getAttribute('aria-current')).toBeNull()
})

test('阅读页归在「研报」栏目下,点它回到列表', () => {
  renderAt('/reports/doc_1')
  expect(tab('研报').getAttribute('aria-current')).toBe('page')

  fireEvent.click(tab('研报'))

  expect(screen.getByText('研报列表')).toBeTruthy()
})
