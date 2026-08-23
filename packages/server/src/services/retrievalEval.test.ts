import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreCase, summarize, type EvalCase } from './retrievalEval.ts'

const c = (over: Partial<EvalCase> = {}): EvalCase => ({
  id: 'x', question: '毛利率是多少', expect: ['毛利率区间'], tags: ['表格'], why: '', ...over,
})
const hits = (...texts: string[]) => texts.map(content => ({ content }))

test('命中在第 1 位:hit=true,rank=1', () => {
  const r = scoreCase(c(), hits('| 环节 | 毛利率区间 |', '别的'))
  assert.equal(r.hit, true)
  assert.equal(r.rank, 1)
})

test('命中在第 3 位:rank=3', () => {
  const r = scoreCase(c(), hits('无关', '无关', '毛利率区间在这'))
  assert.equal(r.rank, 3)
})

test('没命中:hit=false,rank=null', () => {
  const r = scoreCase(c(), hits('无关', '也无关'))
  assert.equal(r.hit, false)
  assert.equal(r.rank, null)
})

test('多个 expect 任一命中即算命中,取最靠前的名次', () => {
  const r = scoreCase(c({ expect: ['甲', '乙'] }), hits('无关', '含乙', '含甲'))
  assert.equal(r.rank, 2)
})

test('forbid 命中记为 violation', () => {
  const r = scoreCase(c({ forbid: ['旧版本'] }), hits('毛利率区间', '这里有旧版本内容'))
  assert.deepEqual(r.violations, ['旧版本'])
})

test('forbid 未命中时 violations 为空', () => {
  assert.deepEqual(scoreCase(c({ forbid: ['旧版本'] }), hits('毛利率区间')).violations, [])
})

// 「知识库无答案」的用例只能用 forbid 表达 —— 检索层永远会返回 maxK 块,
// 无法在这一层断言「什么都没返回」。是否该拒答属于生成层,要另外测。
test('expect 为空(无答案用例)时 hit 为 null,不计入命中率', () => {
  const r = scoreCase(c({ expect: [], forbid: ['宁德时代'] }), hits('腾讯的东西'))
  assert.equal(r.hit, null)
  assert.equal(r.rank, null)
})

test('检索结果为空时不抛错', () => {
  const r = scoreCase(c(), [])
  assert.equal(r.hit, false)
})

// ---------- 汇总 ----------

test('命中率只统计有答案的用例', () => {
  const s = summarize([
    { id: 'a', hit: true, rank: 1, violations: [], tags: [] },
    { id: 'b', hit: false, rank: null, violations: [], tags: [] },
    { id: 'c', hit: null, rank: null, violations: [], tags: [] },  // 无答案用例
  ])
  assert.equal(s.scored, 2)
  assert.equal(s.hits, 1)
  assert.equal(s.hitRate, 0.5)
})

test('MRR 用名次的倒数,未命中记 0', () => {
  const s = summarize([
    { id: 'a', hit: true, rank: 1, violations: [], tags: [] },     // 1
    { id: 'b', hit: true, rank: 4, violations: [], tags: [] },     // 0.25
    { id: 'c', hit: false, rank: null, violations: [], tags: [] }, // 0
  ])
  assert.equal(Number(s.mrr.toFixed(4)), Number((1.25 / 3).toFixed(4)))
})

test('统计 violation 总数', () => {
  const s = summarize([
    { id: 'a', hit: true, rank: 1, violations: ['x', 'y'], tags: [] },
    { id: 'b', hit: true, rank: 1, violations: [], tags: [] },
  ])
  assert.equal(s.violations, 2)
})

// 只看一个总分会掩盖问题:可能「表格类」全错而「定性类」全对,平均下来还不错。
test('按 tag 分组统计,便于定位是哪类问题变差了', () => {
  const s = summarize([
    { id: 'a', hit: true, rank: 1, violations: [], tags: ['表格'] },
    { id: 'b', hit: false, rank: null, violations: [], tags: ['表格'] },
    { id: 'c', hit: true, rank: 2, violations: [], tags: ['口语'] },
  ])
  assert.equal(s.byTag['表格'].hitRate, 0.5)
  assert.equal(s.byTag['口语'].hitRate, 1)
})

test('空输入不产生 NaN', () => {
  const s = summarize([])
  assert.equal(s.hitRate, null)
  assert.equal(s.mrr, 0)
})
