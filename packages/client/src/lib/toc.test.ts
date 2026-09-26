import { test, expect } from 'vitest'
import { extractToc, outlineOf, visibleOutline } from './toc'

test('提取标题与 slug,与后端 slugger 同款', () => {
  const md = '# 标题A\n\n正文\n\n## 1.3 大事件的规律与启示\n\n内容'
  const toc = extractToc(md)
  expect(toc.length).toBe(2)
  expect(toc[1].title).toBe('1.3 大事件的规律与启示')
  expect(toc[1].slug).toBe('13-大事件的规律与启示')
  expect(toc[1].level).toBe(2)
})

test('目录大纲:h1 是标题不进目录,只取两层,节记下所属章', () => {
  const md = '# 标题\n\n## 第一章\n\n### 1.1 小节\n\n#### 更深的不要\n\n## 第二章\n\n### 2.1 小节'
  const outline = outlineOf(extractToc(md))
  expect(outline.map(t => [t.title, t.top, t.chapter])).toEqual([
    ['第一章', true, '第一章'],
    ['1.1 小节', false, '第一章'],
    ['第二章', true, '第二章'],
    ['2.1 小节', false, '第二章'],
  ])
})

test('目录折叠:章全部列出,节只列当前章的', () => {
  const outline = outlineOf(extractToc('## 第一章\n\n### 1.1 小节\n\n### 1.2 小节\n\n## 第二章\n\n### 2.1 小节'))
  const titles = (slug: string) => visibleOutline(outline, slug).map(t => t.title)

  // 高亮的是节时,展开它所在的章
  expect(titles('12-小节')).toEqual(['第一章', '1.1 小节', '1.2 小节', '第二章'])
  expect(titles('第二章')).toEqual(['第一章', '第二章', '2.1 小节'])
  // 还没读到任何标题:只列章
  expect(titles('')).toEqual(['第一章', '第二章'])
})
