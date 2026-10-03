import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferKind, isReportKind } from './reportKind.ts'

test('公司研报:标题里带代码', () => {
  for (const title of [
    '中国海洋石油（0883.HK / 600938.SH）投资研究报告',
    'SK海力士（KRX: 000660 / NASDAQ: SKHY）投资研究报告',
    '贵州茅台（600519.SH）投资研究报告',
    'Albemarle（NYSE: ALB）投资研究报告',
  ]) assert.equal(inferKind(title), 'company', title)
})

test('行业研报:产业链 / 行业', () => {
  for (const title of [
    '碳酸锂产业链投资研究报告',
    '中国海洋石油（CNOOC）产业链投资研究报告',
    '锂资源行业 2026 年中期回顾:出清尚未结束',
  ]) assert.equal(inferKind(title), 'industry', title)
})

test('产业链标题里带了代码,仍是行业研报', () => {
  assert.equal(inferKind('腾讯控股（0700.HK）产业链投资研究报告'), 'industry')
})

test('看不出来返回 null,不猜', () => {
  for (const title of [
    '投研方法论:如何读懂一份看空报告',
    '港股互联网:估值重估走到哪一步了',
    '某某投资研究报告（2026Q3 更新）',
    '某某投资研究报告 v2',
    '',
  ]) assert.equal(inferKind(title), null, title)
})

test('isReportKind', () => {
  assert.equal(isReportKind('company'), true)
  assert.equal(isReportKind('industry'), true)
  assert.equal(isReportKind('other'), false)
  assert.equal(isReportKind(undefined), false)
})
