import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toWeekly, isoWeekKey } from './weekly.ts'
import type { Bar } from './supertrend.ts'

test('isoWeekKey:常规与跨年边界', () => {
  assert.equal(isoWeekKey('2026-08-03'), '2026-W32')  // 周一
  assert.equal(isoWeekKey('2026-08-07'), '2026-W32')  // 周五,同周
  assert.equal(isoWeekKey('2026-08-10'), '2026-W33')
  assert.equal(isoWeekKey('2026-08-20'), '2026-W34')
  // 跨年:2025-12-29(周一)属于 ISO 2026 年第 1 周
  assert.equal(isoWeekKey('2025-12-29'), '2026-W01')
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01')
  // 2026 年有 53 周
  assert.equal(isoWeekKey('2027-01-03'), '2026-W53')
})

const daily: Bar[] = [
  { date: '2026-08-03', high: 110, low: 100, close: 105 },
  { date: '2026-08-05', high: 120, low: 104, close: 118 },
  { date: '2026-08-07', high: 115, low:  98, close: 101 },   // W32 收盘
  { date: '2026-08-10', high: 130, low: 108, close: 125 },
  { date: '2026-08-14', high: 128, low: 112, close: 127 },   // W33 收盘
  { date: '2026-08-17', high: 140, low: 120, close: 138 },
  { date: '2026-08-20', high: 136, low: 118, close: 122 },   // W34,尚未结束
]

test('按 ISO 周聚合:high 取最大、low 取最小、close 取最后一根', () => {
  // 今天在 W35,三周都已结束
  const wk = toWeekly(daily, '2026-08-24')
  assert.equal(wk.length, 3)
  assert.deepEqual(wk[0], { date: '2026-08-07', high: 120, low: 98, close: 101 })
  assert.deepEqual(wk[1], { date: '2026-08-14', high: 130, low: 108, close: 127 })
  assert.deepEqual(wk[2], { date: '2026-08-20', high: 140, low: 118, close: 122 })
})

test('今天所在的那一周被丢弃(本周未结束)', () => {
  // 今天是 2026-08-21,在 W34 内 → 最后一组丢弃
  const wk = toWeekly(daily, '2026-08-21')
  assert.equal(wk.length, 2)
  assert.equal(wk[wk.length - 1].date, '2026-08-14')
})

test('空输入与全部落在本周', () => {
  assert.deepEqual(toWeekly([], '2026-08-21'), [])
  const onlyThisWeek = daily.filter(b => b.date >= '2026-08-17')
  assert.deepEqual(toWeekly(onlyThisWeek, '2026-08-21'), [])
})
