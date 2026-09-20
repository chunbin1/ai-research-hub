import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown } from './markdownParser.ts'
import { computeGen, vectorId, LEGACY_GEN } from './indexGen.ts'

const MD = `# 腾讯生态

## 2.2 生意特征

| 环节 | 毛利率 |
|---|---|
| 游戏 | 61% |
`

const chunks = (md: string, maxChars?: number) => parseMarkdown(md, maxChars ? { maxChars } : {}).chunks

test('同样的切块结果得到同样的代次', () => {
  assert.equal(computeGen(chunks(MD)), computeGen(chunks(MD)))
})

test('原文变了代次就变', () => {
  assert.notEqual(computeGen(chunks(MD)), computeGen(chunks(MD + '\n## 新增\n\n补充。\n')))
})

// 这条是整个方案的地基:切块规则一改,代次必须自动变,不依赖谁记得改版本号。
test('切块参数变了代次就变 —— 不需要手工维护版本号', () => {
  const multi = '## A\n\n第一段正文足够长一些以便切开。\n\n第二段正文也足够长一些以便切开。\n'
  assert.equal(chunks(multi).length, 1)
  assert.equal(chunks(multi, 20).length, 2)
  assert.notEqual(computeGen(chunks(multi)), computeGen(chunks(multi, 20)))
})

test('代次是短哈希,能直接进 id 和日志', () => {
  const g = computeGen(chunks(MD))
  assert.match(g, /^[0-9a-f]{12}$/)
})

// 分隔符用 NUL:正文里不可能出现,所以内容再怎么拼都伪造不出另一个块的边界。
test('相邻块之间挪动一个字符会改变代次', () => {
  const a = [
    { content: 'ab', chunk_index: 0, section_title: '', section_slug: '', section_path: '', char_start: 0, char_end: 2 },
    { content: 'c', chunk_index: 1, section_title: '', section_slug: '', section_path: '', char_start: 2, char_end: 3 },
  ]
  const b = [
    { content: 'a', chunk_index: 0, section_title: '', section_slug: '', section_path: '', char_start: 0, char_end: 1 },
    { content: 'bc', chunk_index: 1, section_title: '', section_slug: '', section_path: '', char_start: 1, char_end: 3 },
  ]
  assert.notEqual(computeGen(a), computeGen(b))
})

test('向量 id 带代次 —— 新旧两代才能共存', () => {
  assert.equal(vectorId('doc_x', 'abc123', 7), 'doc_x_gabc123_chunk_7')
  assert.notEqual(vectorId('doc_x', 'abc123', 7), vectorId('doc_x', LEGACY_GEN, 7))
})
