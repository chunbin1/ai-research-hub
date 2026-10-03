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

test('公司研报的标题里写了「行业」:代码优先,仍是公司研报', () => {
  assert.equal(inferKind('贵州茅台：白酒行业龙头的护城河（600519.SH）'), 'company')
  assert.equal(inferKind('宁德时代（300750.SZ）：动力电池行业的定价者'), 'company')
})

test('没有代码、只写「行业」:行业研报', () => {
  assert.equal(inferKind('光伏行业 2026 展望'), 'industry')
  assert.equal(inferKind('商业航天产业链投资研究报告（以 SpaceX 为轴）'), 'industry')
})

test('产业链标题里带了代码,仍是行业研报', () => {
  assert.equal(inferKind('腾讯控股（0700.HK）产业链投资研究报告'), 'industry')
})

test('其他写法的代码:港股「0700 HK」、路透式「NVDA.O」', () => {
  assert.equal(inferKind('腾讯控股 0700 HK 投资研究报告'), 'company')
  assert.equal(inferKind('英伟达（NVDA.O）投资研究报告'), 'company')
  assert.equal(inferKind('伯克希尔（BRK.N）投资研究报告'), 'company')
})

// 刻意不认的:括号里的裸字母和 HBM / CNOOC / ETF 这类缩写长得一样,认了会把主题报告标成公司
test('括号里的裸字母不认(返回 null,交给管理员选)', () => {
  for (const title of ['苹果（AAPL）投资研究报告', '存储芯片（HBM）投资研究报告', '行业 ETF 配置', 'ai.o 的故事']) {
    assert.equal(inferKind(title), title.includes('行业') ? 'industry' : null, title)
  }
})

// 已知局限,钉在这里免得悄悄变:指数代码和股票代码形状一样
test('指数代码会被判成公司研报(已知局限,只是预填)', () => {
  assert.equal(inferKind('中证500（000905）指数增强策略'), 'company')
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

test('「年份 + 空格 + HK」不是港股代码;点号形式(2020.HK 是安踏)仍是', () => {
  assert.equal(inferKind('2026 HK 科技股中期策略'), null)
  assert.equal(inferKind('港股 2026 hk 展望'), null)
  assert.equal(inferKind('安踏体育 2020.HK 投资研究报告'), 'company')
  assert.equal(inferKind('腾讯控股 0700 HK 投资研究报告'), 'company')
})
