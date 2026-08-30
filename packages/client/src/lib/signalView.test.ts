import { test, expect } from 'vitest'
import {
  dataAsOf, filterCounts, formatFlipDate, isNearStop, isRowNearStop, matchesFilter,
  stopBarWidth, stopDistance,
} from './signalView'
import type { SignalRow, SignalSide } from '../types'

const side = (over: Partial<SignalSide> = {}): SignalSide => ({
  trend: 1, barDate: '2026-08-28', stopLine: 100, closeAdj: 110, atr: 5, distPct: 10,
  flipDate: '2026-08-24', flipPrice: 105, heldDays: 4, sinceFlipPct: 1, ...over,
})

const row = (over: Partial<SignalRow> = {}): SignalRow => ({
  symbol: 'X', name: null, market: 'US', currency: 'USD', closeRaw: 110,
  daily: side(), weekly: side(), divergent: false, flips90d: 0, sourceDoc: null, sourceText: null,
  enabled: true, status: 'ok', lastError: null, lastScanAt: null, ...over,
})

test('距止损去掉正负号 —— 方向由徽章表达,这里只剩距离', () => {
  expect(stopDistance(side({ distPct: -18.8 }))).toBeCloseTo(18.8)
  expect(stopDistance(side({ distPct: 12.4 }))).toBeCloseTo(12.4)
})

test('不足 6% 算临近止损,正负都算', () => {
  expect(isNearStop(side({ distPct: 5.9 }))).toBe(true)
  expect(isNearStop(side({ distPct: -5.9 }))).toBe(true)
  expect(isNearStop(side({ distPct: 6 }))).toBe(false)
})

test('进度条以 17% 为满格,超过不溢出', () => {
  expect(stopBarWidth(side({ distPct: 0 }))).toBe('0.0%')
  expect(stopBarWidth(side({ distPct: 8.5 }))).toBe('50.0%')
  expect(stopBarWidth(side({ distPct: 28.1 }))).toBe('100.0%')
})

test('翻转日期同年省去年份,跨年写全', () => {
  expect(formatFlipDate('2026-08-24', '2026-08-28')).toBe('08-24')
  expect(formatFlipDate('2025-05-16', '2026-08-28')).toBe('2025-05-16')
})

test('筛选按市场与日线方向分流,临近止损看两个周期里任意一个', () => {
  const hkLong = row({ symbol: 'A', market: 'HK' })
  const usShort = row({ symbol: 'B', daily: side({ trend: -1 }) })
  const nearOnWeekly = row({ symbol: 'C', weekly: side({ distPct: -3.2 }) })

  expect(matchesFilter(hkLong, 'HK')).toBe(true)
  expect(matchesFilter(hkLong, 'US')).toBe(false)
  expect(matchesFilter(usShort, 'dailyShort')).toBe(true)
  expect(matchesFilter(usShort, 'dailyLong')).toBe(false)
  expect(isRowNearStop(nearOnWeekly)).toBe(true)
  expect(isRowNearStop(hkLong)).toBe(false)

  const counts = filterCounts([hkLong, usShort, nearOnWeekly])
  expect(counts).toMatchObject({ all: 3, HK: 1, US: 2, dailyLong: 2, dailyShort: 1, nearStop: 1 })
})

test('没有信号的行不进任何方向筛选,也不算临近止损', () => {
  const broken = row({ daily: null, weekly: null, status: 'invalid' })
  expect(matchesFilter(broken, 'dailyLong')).toBe(false)
  expect(matchesFilter(broken, 'dailyShort')).toBe(false)
  expect(matchesFilter(broken, 'nearStop')).toBe(false)
  expect(matchesFilter(broken, 'all')).toBe(true)
})

test('数据截至取所有行里最新的 bar 日期,全无信号时为 null', () => {
  const a = row({ daily: side({ barDate: '2026-08-27' }), weekly: side({ barDate: '2026-08-21' }) })
  const b = row({ daily: side({ barDate: '2026-08-28' }), weekly: side({ barDate: '2026-08-21' }) })
  expect(dataAsOf([a, b])).toBe('2026-08-28')
  expect(dataAsOf([row({ daily: null, weekly: null })])).toBeNull()
})
