// 真实历史数据回归基线。fixture 是冻结快照(截止 2026-08-20),不联网。
// 期望值来自设计文档「参考输出」一节,由与 Pine 等价的参考实现算出。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { supertrend, type Bar } from './supertrend.ts'

const bars = JSON.parse(
  readFileSync(new URL('./__fixtures__/ALB-daily.json', import.meta.url), 'utf8'),
) as Bar[]

const near = (a: number, b: number, msg: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}: 期望 ${b},实际 ${a}`)

test('ALB 5 年日线:序列长度与预热边界', () => {
  assert.equal(bars.length, 1254)
  const pts = supertrend(bars, { period: 10, mult: 3 })
  assert.equal(pts.length, 1245)          // 1254 - (period - 1)
  assert.equal(pts[0].date, '2021-09-03')
  near(pts[0].atr, 7.386700702482514, '首点 ATR')
})

test('ALB 5 年日线:末根状态', () => {
  const pts = supertrend(bars, { period: 10, mult: 3 })
  const last = pts[pts.length - 1]
  assert.equal(last.date, '2026-08-20')
  assert.equal(last.trend, 1)
  near(last.up, 119.36452899657336, '末根 up')
  near(last.dn, 145.7954382856291, '末根 dn')
  near(last.atr, 5.021823769534143, '末根 ATR')
})

test('ALB 5 年日线:翻转序列', () => {
  const pts = supertrend(bars, { period: 10, mult: 3 })
  const flips = pts
    .filter((p, i) => i > 0 && p.trend !== pts[i - 1].trend)
    .map(p => [p.date, p.trend])
  assert.equal(flips.length, 44)
  assert.deepEqual(flips.slice(-4), [
    ['2026-03-03', -1],
    ['2026-04-14', 1],
    ['2026-05-18', -1],
    ['2026-08-07', 1],
  ])
})
