import { test } from 'node:test'
import assert from 'node:assert/strict'
import { supertrend, type Bar } from './supertrend.ts'

/** 前 15 根 100→128,后 15 根 128→98,每根 high/low = close ± 1 */
function syntheticBars(): Bar[] {
  const bars: Bar[] = []
  for (let i = 0; i < 30; i++) {
    const close = i < 15 ? 100 + 2 * i : 128 - 2 * (i - 14)
    bars.push({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      high: close + 1,
      low: close - 1,
      close,
    })
  }
  return bars
}

const near = (a: number, b: number, msg: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${msg}: 期望 ${b},实际 ${a}`)

test('输出从下标 period-1 开始,ATR 用前 period 根的 SMA 播种', () => {
  const pts = supertrend(syntheticBars(), { period: 10, mult: 3 })
  assert.equal(pts.length, 21)
  assert.equal(pts[0].date, '2026-01-10')
  // 前 10 根 TR:首根 = high-low = 2;其余每根 = high - close_prev = 3。
  // SMA = (2 + 3*9) / 10 = 2.9
  near(pts[0].atr, 2.9, '播种 ATR')
  near(pts[0].up, 109.3, '首点 up')
  near(pts[0].dn, 126.7, '首点 dn')
})

test('上涨段 up 持续抬高,转跌后棘轮冻结不回落', () => {
  const pts = supertrend(syntheticBars(), { period: 10, mult: 3 })
  const at = (d: string) => pts.find(p => p.date === d)!
  near(at('2026-01-11').up, 111.27, '01-11 up')
  near(at('2026-01-15').up, 119.177147, '01-15 up(涨到顶)')
  // 01-16 起价格转跌,但 close[i-1] 仍在 up 之上 → up 取 max,冻结在 119.177147
  near(at('2026-01-16').up, 119.177147, '01-16 up 冻结')
  near(at('2026-01-19').up, 119.177147, '01-19 up 仍冻结')
})

test('收盘跌破冻结的 up 线时翻空,且只翻一次', () => {
  const pts = supertrend(syntheticBars(), { period: 10, mult: 3 })
  const flips = pts.filter((p, i) => i > 0 && p.trend !== pts[i - 1].trend)
  assert.equal(flips.length, 1)
  assert.equal(flips[0].date, '2026-01-20')
  assert.equal(flips[0].trend, -1)
  // 翻转后下一根 up 重置为原始值,不再沿用冻结值
  near(pts.find(p => p.date === '2026-01-21')!.up, 107.094143, '翻转后 up 重置')
})

test('翻转后趋势保持粘性直到反向击穿', () => {
  const pts = supertrend(syntheticBars(), { period: 10, mult: 3 })
  const after = pts.filter(p => p.date >= '2026-01-20')
  assert.ok(after.every(p => p.trend === -1), '翻空后不应再出现多头点')
})

test('bars 不够算 ATR 时返回空数组', () => {
  // 数学守卫:period=10 需要至少 11 根。120 根的业务门槛不在这里,在 scanner。
  const make = (n: number): Bar[] =>
    Array.from({ length: n }, (_, i) => ({ date: `d${i}`, high: 101, low: 99, close: 100 }))
  assert.deepEqual(supertrend([]), [])
  assert.deepEqual(supertrend(make(10), { period: 10, mult: 3 }), [])
  assert.equal(supertrend(make(11), { period: 10, mult: 3 }).length, 2)
})

test('period 小于 2 时返回空数组,而不是越界崩溃', () => {
  // period=1 时循环从 i=0 开始,首轮就要读 bars[i-1] —— 必须挡在门口。
  const make = (n: number): Bar[] =>
    Array.from({ length: n }, (_, i) => ({ date: `d${i}`, high: 101, low: 99, close: 100 }))
  assert.deepEqual(supertrend(make(50), { period: 1, mult: 3 }), [])
  assert.deepEqual(supertrend(make(50), { period: 0, mult: 3 }), [])
})

test('不传 opts 时用默认 period=10 / mult=3', () => {
  const make = (n: number): Bar[] =>
    Array.from({ length: n }, (_, i) => ({ date: `d${i}`, high: 101, low: 99, close: 100 }))
  assert.deepEqual(supertrend(make(20)), supertrend(make(20), { period: 10, mult: 3 }))
  assert.equal(supertrend(make(20)).length, 11)
})
