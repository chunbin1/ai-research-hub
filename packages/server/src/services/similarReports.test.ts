import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findSimilarReports, type ExistingReport } from './similarReports.ts'

// 生产库里的真实标题:大半是「XX产业链投资研究报告」,查重最容易栽在这套模板上
const TITLES = [
  '锂资源行业 2026 年中期回顾:出清尚未结束',
  'AI 算力产业链跟踪:从缺卡到缺电',
  '港股互联网:估值重估走到哪一步了',
  '投研方法论:如何读懂一份看空报告',
  '碳酸锂产业链投资研究报告',
  '贵州茅台（600519.SH）投资研究报告',
  '海力士 / 存储芯片（HBM）产业链投资研究报告',
  '中国海洋石油（CNOOC）产业链投资研究报告',
  '腾讯生态产业链投资研究报告',
  '煤炭（煤—电—路—港—航—化 一体化）产业链投资研究报告',
  '商业航天产业链投资研究报告（以 SpaceX 为轴）',
]

/** 标题测试只看标题,每篇正文给一段互不重合、也不和上传的重合的 */
const library: ExistingReport[] = TITLES.map((title, i) => ({
  id: `doc_${i}`,
  title,
  markdown: `# ${title}\n\n${'甲乙丙丁戊己庚辛壬癸子'[i].repeat(40)}\n`,
}))

const idOf = (title: string) => library.find(r => r.title === title)!.id
const check = (title: string, markdown = `# ${title}\n\n全新的正文。\n`) =>
  findSimilarReports({ title, markdown }, library)

test('标题改了一部分(加版本后缀 / 换说法)仍能认出旧版本', () => {
  for (const [title, old] of [
    ['腾讯生态产业链投资研究报告(2026Q3 更新)', '腾讯生态产业链投资研究报告'],
    ['腾讯控股投资研究报告', '腾讯生态产业链投资研究报告'],
    ['碳酸锂投资研究报告 v2', '碳酸锂产业链投资研究报告'],
    ['茅台（600519）投资研究报告', '贵州茅台（600519.SH）投资研究报告'],
    ['AI 算力产业链跟踪：缺电之后', 'AI 算力产业链跟踪:从缺卡到缺电'],
  ]) {
    const hits = check(title)
    assert.equal(hits[0]?.id, idOf(old), title)
  }
})

test('只是套了同一个标题模板的不算:「宁德时代产业链投资研究报告」没有候选', () => {
  assert.deepEqual(check('宁德时代产业链投资研究报告'), [])
  assert.deepEqual(check('苹果（AAPL）投资研究报告'), [])
})

test('标题完全改掉,正文大段相同也能认出来', () => {
  const body = '## 1 核心结论\n\n海上油气产量连续五年增长,桶油成本低于三十美元,分红率维持在四成以上。\n'.repeat(5)
  const lib = [...library, { id: 'cnooc_old', title: '中国海洋石油（CNOOC）深度', markdown: `# 旧标题\n\n${body}` }]
  const hits = findSimilarReports({ title: '中海油:高股息的底气', markdown: `# 中海油\n\n${body}补充 Q3 数据。\n` }, lib)
  assert.equal(hits[0].id, 'cnooc_old')
  assert.ok(hits[0].contentScore > 0.5, String(hits[0].contentScore))
  assert.equal(hits[0].titleScore, 0)
})

test('原文缺失的老文档只比标题,不因此报错', () => {
  const lib = [{ id: 'legacy', title: '腾讯生态产业链投资研究报告', markdown: null }, ...library.slice(0, 4)]
  const hits = findSimilarReports({ title: '腾讯生态(Q3 更新)', markdown: '# 腾讯生态(Q3 更新)\n' }, lib)
  assert.equal(hits[0].id, 'legacy')
  assert.equal(hits[0].contentScore, 0)
})

test('空库没有候选;候选最多 3 篇', () => {
  assert.deepEqual(findSimilarReports({ title: '腾讯', markdown: '# 腾讯\n' }, []), [])
  // 同名的有 5 篇:标题里每个字都「常见」,也得认出是同一篇
  const same = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, title: '腾讯生态', markdown: null }))
  const hits = findSimilarReports({ title: '腾讯生态 v2', markdown: '# 腾讯生态 v2\n' }, same)
  assert.equal(hits.length, 3)
  assert.equal(hits[0].titleScore, 1)
})
