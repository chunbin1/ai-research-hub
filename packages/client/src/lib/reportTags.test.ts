import { test, expect } from 'vitest'
import { countSectors, deriveReportTags } from './reportTags'

test('从标题里认出显式市场字样', () => {
  expect(deriveReportTags('港股互联网:估值重估走到哪一步了').market).toBe('港股')
  expect(deriveReportTags('美股 AI 算力跟踪').market).toBe('美股')
})

test('认出代码后缀形式的市场', () => {
  expect(deriveReportTags('贵州茅台(600519.SH)投资研究报告').market).toBe('A股')
  expect(deriveReportTags('腾讯控股(0700.HK)研究').market).toBe('港股')
  expect(deriveReportTags('Albemarle(NYSE: ALB)研究').market).toBe('美股')
})

test('认不出市场就留空,不猜', () => {
  expect(deriveReportTags('投研方法论:如何读懂一份看空报告').market).toBeNull()
})

test('行业既认行业词也认龙头公司名', () => {
  expect(deriveReportTags('AI 算力产业链跟踪:从缺卡到缺电').sector).toBe('半导体')
  expect(deriveReportTags('腾讯生态产业链投资研究报告').sector).toBe('互联网')
  expect(deriveReportTags('投研方法论:如何读懂一份看空报告').sector).toBeNull()
})

// 规则有序是这个模块的核心约束:窄的必须排在宽的前面,否则「石油 / 新能源」
// 会被「能源」整段吃掉。这三条是最容易被后来插入的新规则打破的。
test('窄行业优先于宽行业', () => {
  expect(deriveReportTags('中国海洋石油(CNOOC)产业链投资研究报告').sector).toBe('石油')
  expect(deriveReportTags('锂资源行业 2026 年中期回顾:出清尚未结束').sector).toBe('新能源')
  expect(deriveReportTags('煤炭(煤—电—路—港—航—化 一体化)产业链投资研究报告').sector).toBe('能源')
})

// 「煤—电—路—港—航—化」里的「港」「航」是产业链环节,不是港股、更不是商业航天。
// 市场词与行业词都要求整词命中,这条用来钉住这个边界。
test('单字不构成市场或行业命中', () => {
  const tags = deriveReportTags('煤炭(煤—电—路—港—航—化 一体化)产业链投资研究报告')
  expect(tags.market).toBeNull()
  expect(tags.sector).toBe('能源')
})

test('按板块计数,多到少排序,认不出行业的不进桶', () => {
  expect(countSectors([
    '腾讯生态产业链投资研究报告',
    '港股互联网:估值重估走到哪一步了',
    'AI 算力产业链跟踪:从缺卡到缺电',
    '投研方法论:如何读懂一份看空报告',
  ])).toEqual([
    { sector: '互联网', count: 2 },
    { sector: '半导体', count: 1 },
  ])
})

test('计数相同时按规则表顺序稳定排列', () => {
  expect(countSectors(['腾讯生态产业链投资研究报告', 'HBM 存储芯片研究']))
    .toEqual([
      { sector: '半导体', count: 1 },
      { sector: '互联网', count: 1 },
    ])
})
