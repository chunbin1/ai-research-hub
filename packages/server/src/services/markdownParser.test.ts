import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown } from './markdownParser.ts'

const SAMPLE = `# 碳酸锂产业链投资研究报告

导言一句话。

## 1.2 重大事件编年

事件表格内容。

## 1.3 大事件的规律与启示

三条铁律:一供给、二种子、三政策。
`

test('displayName 取首个 H1', () => {
  const { displayName } = parseMarkdown(SAMPLE)
  assert.equal(displayName, '碳酸锂产业链投资研究报告')
})

test('按标题切出正确的章节数(引言 + H1 + 两个 H2)', () => {
  const { chunks } = parseMarkdown(SAMPLE)
  const titles = chunks.map(c => c.section_title)
  assert.ok(titles.includes('1.2 重大事件编年'))
  assert.ok(titles.includes('1.3 大事件的规律与启示'))
})

test('section_slug 与 github-slugger 对同序标题一致', () => {
  const { chunks } = parseMarkdown(SAMPLE)
  const c = chunks.find(c => c.section_title === '1.3 大事件的规律与启示')!
  assert.equal(c.section_slug, '13-大事件的规律与启示')
})

test('section_path 含祖先标题', () => {
  const { chunks } = parseMarkdown(SAMPLE)
  const c = chunks.find(c => c.section_title === '1.2 重大事件编年')!
  assert.equal(c.section_path, '碳酸锂产业链投资研究报告 / 1.2 重大事件编年')
})

test('char_start/char_end 定位准确', () => {
  const { chunks } = parseMarkdown(SAMPLE)
  const c = chunks.find(c => c.section_title === '1.3 大事件的规律与启示')!
  assert.ok(SAMPLE.slice(c.char_start, c.char_end).includes('三条铁律'))
})

test('超长章节按段落二次切分,共享章节字段', () => {
  const big = '# H\n\n' + Array.from({ length: 20 }, (_, i) => `第${i}段。`.repeat(30)).join('\n\n')
  const { chunks } = parseMarkdown(big, { maxChars: 300 })
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(c => c.section_title === 'H'))
  chunks.forEach((c, i) => assert.equal(c.chunk_index, i))
})
