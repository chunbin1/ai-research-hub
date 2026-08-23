import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeCitations } from './citationMetrics.ts'
import type { DocumentChunk } from '../types.ts'

/** 只有 section_title 参与统计,其余字段填占位值。 */
function chunk(section_title: string, chunk_index = 0): DocumentChunk {
  return {
    doc_id: 'doc_1', filename: 'r.md', chunk_index,
    content: '', distance: 0.5, section_title,
    section_slug: section_title,
  }
}

const TEN = [
  '第七步：投资组合配置建议',
  '4.6 推荐度：★★★★★（核心仓位候选）',
  '第三步：全球上市公司扫描',
  '4.5 估值快照（2026 年中）',
  '一句话结论',
  '2.2 各环节“生意特征”',
  '7.2 买入/卖出信号',
  '腾讯音乐 TME',
  '拼多多 PDD',
  '快手',
].map((t, i) => chunk(t, i))

test('引用一个章节时,coverage = 1/章节数', () => {
  const answer = '游戏毛利率高。\n\n【来源:§2.2 各环节“生意特征”】'
  const s = analyzeCitations(answer, TEN)
  assert.equal(s.promptChunks, 10)
  assert.equal(s.promptSections, 10)
  assert.equal(s.citedSections, 1)
  assert.equal(s.coverage, 0.1)
})

// 线上真实回归:模型把原文的全角双引号“” 改写成了半角单引号 ''。
// 严格比对会把这次引用判成「没引用」,coverage 从 0.10 变成 0.00。
test('模型改写标点后仍能匹配上原章节', () => {
  const answer = "游戏毛利率高。【来源:§2.2 各环节'生意特征'】"
  const s = analyzeCitations(answer, TEN)
  assert.equal(s.citedSections, 1)
  assert.deepEqual(s.citedUnknown, [])
})

test('同一章节引用多次只算一次', () => {
  const answer = '总收入 7517 亿【来源:§一句话结论】,净利润【来源:§一句话结论】,增速【来源:§一句话结论】'
  const s = analyzeCitations(answer, TEN)
  assert.equal(s.citedSections, 1)
  assert.equal(s.coverage, 0.1)
})

test('全角冒号的标注也能解析', () => {
  const s = analyzeCitations('结论【来源：§快手】', TEN)
  assert.equal(s.citedSections, 1)
})

// 线上真实回归:模型会把章节名的括号后缀截掉再引用。
// prompt 给的是「1.2 重大事件编年（Timeline）」,模型只写「1.2 重大事件编年」。
// 这不是编造来源 —— 严格比对会误判成幻觉,并把 coverage 从 0.20 归零。
test('模型截短章节名(去掉括号后缀)仍算命中,不计入幻觉', () => {
  const chunks = [
    chunk('1.2 重大事件编年（Timeline）', 0),
    chunk('附：待核验数据清单（准出前必查）🔴', 1),
  ]
  const answer = '价格 16.79 万元/吨【来源:§1.2 重大事件编年】,建议核实【来源:§附：待核验数据清单】'
  const s = analyzeCitations(answer, chunks)
  assert.equal(s.citedSections, 2)
  assert.deepEqual(s.citedUnknown, [])
  assert.equal(s.coverage, 1)
})

test('截短后前缀同时命中多个章节时,只记一个(取最短的那个),结果稳定', () => {
  const chunks = [chunk('3.1 产业链结构（上游）', 0), chunk('3.1 产业链结构', 1), chunk('一句话结论', 2)]
  const s = analyzeCitations('【来源:§3.1 产业链结构】', chunks)
  assert.equal(s.citedSections, 1)
  assert.deepEqual(s.citedUnknown, [])
})

test('引用了 prompt 里没有的章节 → 计入 citedUnknown,不计入 citedSections', () => {
  const s = analyzeCitations('据第九步分析【来源:§第九步：凭空捏造】', TEN)
  assert.equal(s.citedSections, 0)
  assert.deepEqual(s.citedUnknown, ['第九步：凭空捏造'])
  assert.equal(s.coverage, 0)
})

// 前缀匹配的边界:空字符串是任何字符串的前缀。模型写出「【来源:§ 】」这种
// 空标注时,不能让它白捡一个命中。
test('空的来源标注不算命中任何章节', () => {
  const s = analyzeCitations('结论如下【来源:§ 】', TEN)
  assert.equal(s.citedSections, 0)
  assert.equal(s.coverage, 0)
})

test('答案没有任何来源标注 → citedSections 0', () => {
  const s = analyzeCitations('根据文档,碳酸锂价格为 16.79 万元/吨。', TEN)
  assert.equal(s.citedSections, 0)
  assert.equal(s.coverage, 0)
  assert.deepEqual(s.citedUnknown, [])
})

// 检索返回空时分母为 0。返回 NaN 会被 JSON 序列化成 null,语义上和「覆盖率为零」
// 混淆 —— 显式返回 null 表示「不适用」。
test('chunks 为空 → coverage 为 null 而非 NaN', () => {
  const s = analyzeCitations('报告中未提及。', [])
  assert.equal(s.promptChunks, 0)
  assert.equal(s.promptSections, 0)
  assert.equal(s.coverage, null)
})

test('同一章节的多个 chunk:promptChunks 不去重,promptSections 去重', () => {
  const chunks = [chunk('2.2 生意特征', 0), chunk('2.2 生意特征', 1), chunk('一句话结论', 2)]
  const s = analyzeCitations('【来源:§2.2 生意特征】', chunks)
  assert.equal(s.promptChunks, 3)
  assert.equal(s.promptSections, 2)
  assert.equal(s.citedSections, 1)
  assert.equal(s.coverage, 0.5)
})

test('空章节名的块在 prompt 里显示为「引言」,引用「引言」能匹配上', () => {
  const chunks = [chunk('', 0), chunk('一句话结论', 1)]
  const s = analyzeCitations('【来源:§引言】', chunks)
  assert.equal(s.citedSections, 1)
  assert.deepEqual(s.citedUnknown, [])
})
