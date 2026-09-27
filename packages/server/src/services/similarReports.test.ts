import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findSimilarReports, topicScores, type ExistingReport } from './similarReports.ts'

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
    assert.equal(hits[0].likely, true, title)
    assert.notEqual(hits[0].titleMatch, null, title)
  }
})

test('标题正文没对上、主题也没有明显领先的:一篇不列(套同一个标题模板的也一样)', () => {
  // 主题分挤在一起,最高的也只比中位数高 0.05
  const topic = library.map((_, i) => 0.6 - i / 100)
  for (const title of ['宁德时代产业链投资研究报告', '中国大模型产业研究']) {
    assert.deepEqual(findSimilarReports({ title, markdown: `# ${title}\n\n全新的正文。\n` }, library, topic), [], title)
  }
})

test('向量不可用(没有主题分)时只返回 likely 的:不相干的一篇都不列,好让上传直接走新建', () => {
  assert.deepEqual(check('宁德时代产业链投资研究报告'), [])
  const hits = check('腾讯控股投资研究报告')
  assert.deepEqual(hits.map(h => h.id), [idOf('腾讯生态产业链投资研究报告')])
})

test('股票代码整段比:代码不同的不因「60」「sh」这类碎片撞上,代码相同的认得出', () => {
  assert.deepEqual(check('中国神华（601088.SH）投资研究报告'), [], '神华不该撞上茅台')
  assert.deepEqual(check('（601088.SH）投资研究报告'), [], '去掉代码后标题一样,但代码对不上')
  for (const title of ['茅台（600519）投资研究报告', '600519.SH 深度研究', '贵州茅台投资研究报告']) {
    const hits = check(title)
    assert.equal(hits[0]?.id, idOf('贵州茅台（600519.SH）投资研究报告'), title)
  }
  // 年份正则不能把代码里的「2049」切掉
  const lib = [{ id: 'x', title: '紫光国微（002049.SZ）研究', markdown: null }, ...library]
  assert.equal(findSimilarReports({ title: '002049 深度', markdown: '# 002049 深度\n' }, lib)[0]?.id, 'x')
})

test('标题、正文都对不上时,只列主题明显领先的,按主题分排', () => {
  // 中位数 0.4:0.66 和 0.58 领先 ≥ 0.15,0.5 只领先 0.1
  const topic = library.map((_, i) => (i === 7 ? 0.66 : i === 4 ? 0.58 : i === 9 ? 0.5 : 0.4))
  const hits = findSimilarReports({ title: '中海油:高股息的底气', markdown: '# 中海油\n\n桶油成本。\n' }, library, topic)
  assert.deepEqual(hits.map(h => h.id), ['doc_7', 'doc_4'])
  assert.equal(hits[0].topicScore, 0.66)
  assert.equal(hits[0].likely, false)
})

test('库里不足 4 篇时不看主题,只列标题或正文对上的', () => {
  const lib = library.slice(4, 7)
  assert.deepEqual(findSimilarReports({ title: '中海油', markdown: '# 中海油\n' }, lib, [0.9, 0.1, 0.1]), [])
})

test('标题或正文过线的排在主题相近的前面', () => {
  const tx = idOf('腾讯生态产业链投资研究报告')
  // 故意让不相干的一篇主题分更高
  const topic = library.map((_, i) => (i === 0 ? 0.9 : 0.3))
  const hits = findSimilarReports({ title: '腾讯控股投资研究报告', markdown: '# 腾讯控股\n' }, library, topic)
  assert.equal(hits[0].id, tx)
  assert.equal(hits[1].id, 'doc_0')
})

test('主题相近度:库里的指纹只算一次,版本变了重算,原文缺失的用标题', async () => {
  const calls: string[][] = []
  // 假 embedding:按首字区分方向,够验证余弦与缓存
  const embed = async (texts: string[]) => {
    calls.push(texts)
    return texts.map(t => (t.includes('腾讯') ? [1, 0] : [0, 1]))
  }
  const lib: ExistingReport[] = [
    { id: 'a', title: '腾讯', markdown: '# 腾讯生态\n\n社交与游戏。' },
    { id: 'b', title: '茅台', markdown: '# 茅台\n\n白酒。' },
    { id: 'c', title: '腾讯老报告', markdown: null },
  ]
  const model = `test-${Math.random()}`
  assert.deepEqual(await topicScores('# 腾讯控股\n', lib, embed, model), [1, 0, 1])
  assert.equal(calls[0].length, 4)
  assert.equal(calls[0][3], '腾讯老报告')

  await topicScores('# 茅台 2027\n', lib, embed, model)
  assert.deepEqual(calls[1], ['# 茅台 2027\n'], '库里的指纹走缓存,只算上传这篇')

  lib[1] = { ...lib[1], markdown: '# 茅台\n\n白酒,新版。' }
  await topicScores('# 茅台 2027\n', lib, embed, model)
  assert.equal(calls[2].length, 2, '版本变了只重算变了的那篇')

  // 库里少了一篇:它的指纹从缓存里清掉,再出现时要重算
  await topicScores('# 茅台\n', lib.slice(0, 2), embed, model)
  await topicScores('# 茅台\n', lib, embed, model)
  assert.deepEqual(calls[4], ['# 茅台\n', '腾讯老报告'])
})

test('标题完全改掉,正文大段相同也能认出来', () => {
  const body = '## 1 核心结论\n\n海上油气产量连续五年增长,桶油成本低于三十美元,分红率维持在四成以上。\n'.repeat(5)
  const lib = [...library, { id: 'cnooc_old', title: '中国海洋石油（CNOOC）深度', markdown: `# 旧标题\n\n${body}` }]
  const hits = findSimilarReports({ title: '中海油:高股息的底气', markdown: `# 中海油\n\n${body}补充 Q3 数据。\n` }, lib)
  assert.equal(hits[0].id, 'cnooc_old')
  assert.ok(hits[0].contentScore > 0.5, String(hits[0].contentScore))
  assert.equal(hits[0].contentMatch, true)
  assert.equal(hits[0].titleScore, 0)
  assert.equal(hits[0].titleMatch, null)
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
  assert.equal(hits[0].titleMatch, 'same')
})
