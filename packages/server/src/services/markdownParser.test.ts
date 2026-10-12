import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown, outlineOf, INTRO_SLUG } from './markdownParser.ts'

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

// ── 标题即内容:线上丢数据的那个 bug ──────────────────────────────

const HEADING_AS_CONTENT = `# 中国海洋石油

导言。

### 4.C 海油工程

#### 4.C.4 管理层：CNOOC 集团 ~55.3% 控股。简评 **B**。

#### 4.C.5 估值：市值 ~¥252 亿，P/E ~12x，股息率 ~3.4%（派息率 41.6%）。

#### 4.C.6 推荐度：**★★★☆☆（观察名单）**——工程生意质地一般。
`

test('标题行塞满内容、标题后无正文的小节不再被丢掉', () => {
  const { chunks } = parseMarkdown(HEADING_AS_CONTENT)
  const all = chunks.map(c => c.content).join('\n')
  assert.ok(all.includes('~¥252 亿'), '估值那行必须进到某个 chunk 里')
  assert.ok(all.includes('55.3%'), '管理层那行必须进到某个 chunk 里')
  assert.ok(all.includes('★★★☆☆'), '推荐度那行必须进到某个 chunk 里')
})

test('每个块都从自己的标题行开始 —— 向量那一路才看得见标题', () => {
  const { chunks } = parseMarkdown(HEADING_AS_CONTENT)
  const c = chunks.find(c => c.section_title.startsWith('4.C.5'))!
  assert.ok(c.content.startsWith('#### 4.C.5 估值'))
})

test('纯导航标题(自己没正文、但有子标题)不单独成块,并进下一节开头', () => {
  const md = `## 第二部分：产业链全景图

### 2.1 上游

上游正文。
`
  const { chunks } = parseMarkdown(md)
  assert.equal(chunks.length, 1, '「第二部分」不该产生一个只有标题的空壳块')
  assert.equal(chunks[0].section_title, '2.1 上游')
  assert.ok(chunks[0].content.includes('第二部分：产业链全景图'), '父标题顺延并入子节,不能丢')
})

test('不变式:原文每个非空白字符都落在某个块的 [char_start,char_end) 内', () => {
  for (const md of [SAMPLE, HEADING_AS_CONTENT]) {
    const { chunks } = parseMarkdown(md, { maxChars: 120 })
    const covered = new Uint8Array(md.length)
    for (const c of chunks) covered.fill(1, c.char_start, c.char_end)
    const missed: string[] = []
    for (let i = 0; i < md.length; i++) {
      if (!covered[i] && md[i].trim()) missed.push(`${i}:${md[i]}`)
    }
    assert.deepEqual(missed, [], `这些字符掉在所有块之外: ${missed.slice(0, 20).join(' ')}`)
  }
})

test('超长小节不会把标题切成孤立的空壳块', () => {
  const table = Array.from({ length: 40 }, (_, i) => `| 公司${i} | 代码${i} | 市值${i} |`).join('\n')
  const { chunks } = parseMarkdown(`### 3.2 游戏开发/发行\n\n${table}\n`, { maxChars: 300 })
  assert.ok(chunks[0].content.length > 60, `第一块不该只剩标题: ${JSON.stringify(chunks[0].content)}`)
  assert.ok(chunks[0].content.includes('游戏开发/发行') && chunks[0].content.includes('公司0'),
    '标题必须和它后面的内容待在同一块里')
})

test('纯导航标题后面跟一条分隔线,仍算没有正文', () => {
  const { chunks } = parseMarkdown(`# 第四步：头部公司分析\n\n---\n\n## 4.1 神华\n\n神华正文。\n`)
  assert.equal(chunks.length, 1)
  assert.ok(chunks[0].content.includes('第四步：头部公司分析'))
})

test('outlineOf:每节范围含子节,止于下一个同级或更高级标题', () => {
  const md = '# 总\n\n## 一\n\n正文一\n\n### 一.1\n\n细节\n\n## 二\n\n正文二\n'
  const out = outlineOf(md)
  assert.deepEqual(out.map(o => [o.level, o.title]), [[1, '总'], [2, '一'], [3, '一.1'], [2, '二']])
  const one = out[1]
  assert.equal(md.slice(one.start, one.end), '## 一\n\n正文一\n\n### 一.1\n\n细节\n\n')
  const two = out[3]
  assert.equal(md.slice(two.start, two.end), '## 二\n\n正文二\n')
  assert.equal(out[0].end, md.length)
})

test('outlineOf:slug 与切块用的一致(同名标题按顺序去重)', () => {
  const md = '## 风险\n\na\n\n## 风险\n\nb\n'
  assert.deepEqual(outlineOf(md).map(o => o.slug), ['风险', '风险-1'])
})

test('代码块里的 # 注释不算标题(评审复现)', () => {
  const md = '# 一\n\n```python\n# 注释\n```\n\n## 二\n\n正文\n'
  const out = outlineOf(md)
  assert.deepEqual(out.map(o => [o.level, o.title]), [[1, '一'], [2, '二']])
  // 「一」整节含代码块,不在代码块中间截断
  assert.equal(out[0].end, md.length)
  // 切块同样不把代码注释当章节
  assert.ok(parseMarkdown(md).chunks.every(c => c.section_title !== '注释'))
})

test('围栏须同字符闭合:``` 块里的 ~~~ 只是代码', () => {
  const md = '```\n~~~\n# 还在代码里\n```\n\n## 真标题\n'
  // 开头的代码块落在引言里,标题只有一个
  assert.deepEqual(outlineOf(md).filter(o => o.slug !== INTRO_SLUG).map(o => o.title), ['真标题'])
})

test('outlineOf:首个标题前有引言时,目录第一条是引言', () => {
  const md = '数据截至 2026-09。\n\n# 标题\n\n正文\n'
  const out = outlineOf(md)
  assert.deepEqual(out[0], { level: 0, title: '引言', slug: INTRO_SLUG, start: 0, end: md.indexOf('# 标题') })
  // 没有引言(或只有空白)就不出这一条
  assert.equal(outlineOf('\n\n# 标题\n').some(o => o.slug === INTRO_SLUG), false)
})
