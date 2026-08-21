// 真实历史数据回归基线。fixture 是冻结快照(截止 2026-08-20),不联网。
//
// ⚠️ 期望值是从**已提交的这份 fixture** 算出来的,不是从「某次 Yahoo 请求」算出来的。
// Yahoo 的 adjclose 会在两次请求之间发生 ~1e-7 量级的浮点抖动(实测同一天两次取数,
// 1254 根里有 747 根不同),所以重新生成 fixture **会让本测试失败**。
// 这是刻意的:fixture 变了就该有人来看一眼,而不是无脑重新基线化。
// 真要重建 fixture,必须用独立实现交叉验算后再更新这里的期望值。
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
  near(pts[0].atr, 7.386699176133493, '首点 ATR')
})

test('ALB 5 年日线:末根状态', () => {
  const pts = supertrend(bars, { period: 10, mult: 3 })
  const last = pts[pts.length - 1]
  assert.equal(last.date, '2026-08-20')
  assert.equal(last.trend, 1)
  near(last.up, 119.36452899658198, '末根 up')
  near(last.dn, 145.79543828561287, '末根 dn')
  near(last.atr, 5.0218237695312675, '末根 ATR')
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
