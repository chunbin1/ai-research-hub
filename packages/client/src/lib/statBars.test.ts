import { test, expect } from 'vitest'
import { statBars } from './statBars'

test('按次数降序,pct 相对最大值归一化', () => {
  const bars = statBars({ a: 1, b: 4, c: 2 })
  expect(bars.map(x => x.reason)).toEqual(['b', 'c', 'a'])
  expect(bars[0].pct).toBe(100)
  expect(bars[1].pct).toBe(50)
})

test('空对象返回空数组', () => {
  expect(statBars({})).toEqual([])
})
