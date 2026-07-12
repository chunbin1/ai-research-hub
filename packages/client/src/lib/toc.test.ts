import { test, expect } from 'vitest'
import { extractToc } from './toc'

test('提取标题与 slug,与后端 slugger 同款', () => {
  const md = '# 标题A\n\n正文\n\n## 1.3 大事件的规律与启示\n\n内容'
  const toc = extractToc(md)
  expect(toc.length).toBe(2)
  expect(toc[1].title).toBe('1.3 大事件的规律与启示')
  expect(toc[1].slug).toBe('13-大事件的规律与启示')
  expect(toc[1].level).toBe(2)
})
