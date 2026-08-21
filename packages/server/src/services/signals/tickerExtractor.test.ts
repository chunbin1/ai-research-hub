import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractTickersFromTitles } from './tickerExtractor.ts'

// 下面这些标题原样取自库中《碳酸锂产业链投资研究报告》,注意是全角括号。
test('从真实章节标题抽取', () => {
  const got = extractTickersFromTitles([
    '碳酸锂产业链投资研究报告',
    '第四部分：全球上市公司扫描',
    '## 5.1 天齐锂业（002466 / 09696.HK）★★★★☆'.replace(/^## /, ''),
    '5.2 赣锋锂业（002460 / 01772.HK）★★★★☆',
    '5.3 盐湖股份（000792）★★★★☆',
    '5.4 SQM（NYSE: SQM）★★★☆☆',
    '5.5 Albemarle（NYSE: ALB）★★★★☆',
  ])
  assert.deepEqual(got.map(t => t.symbol), ['9696.HK', '1772.HK', 'SQM', 'ALB'])
  assert.deepEqual(got.map(t => t.market), ['HK', 'HK', 'US', 'US'])
})

test('盐湖股份只有 A 股,不产生条目', () => {
  const got = extractTickersFromTitles(['5.3 盐湖股份（000792）★★★★☆'])
  assert.deepEqual(got, [])
})

test('不把普通标题词误当代码', () => {
  assert.deepEqual(extractTickersFromTitles([
    '行业 ETF', 'A 股（中国）', '港股', '美股 / 国际', 'Tier 2 快评',
    '第一部分：碳酸锂发展大事记（用户重点）',
  ]), [])
})

test('同一代码多次出现只保留第一次,并记录来源标题', () => {
  const got = extractTickersFromTitles([
    '5.5 Albemarle（NYSE: ALB）',
    '附录 Albemarle 补充（NYSE: ALB）',
  ])
  assert.equal(got.length, 1)
  assert.equal(got[0].symbol, 'ALB')
  assert.equal(got[0].sourceText, '5.5 Albemarle（NYSE: ALB）')
})

test('空输入', () => {
  assert.deepEqual(extractTickersFromTitles([]), [])
  assert.deepEqual(extractTickersFromTitles(['', '   ']), [])
})
