import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initSignalTables, replaceStates, replaceEvents, getLatestState,
  getStates, getLatestEvent, countEventsSince, getRecentEvents,
  type DailyState, type SignalEvent,
} from './signalStore.ts'

const state = (bar_date: string, trend: 1 | -1, over: Partial<DailyState> = {}): DailyState => ({
  symbol: 'ALB', timeframe: '1d', bar_date, trend,
  stop_line: 119.36, close_adj: 134.19, close_raw: 134.19, atr: 5.02, ...over,
})
const event = (bar_date: string, direction: 1 | -1): SignalEvent =>
  ({ symbol: 'ALB', timeframe: '1d', bar_date, direction, price: 131.11 })

beforeEach(() => {
  initSignalTables(new Database(':memory:'))
})

test('写入后能按倒序读回,并取到最新一条', () => {
  replaceStates('ALB', '1d', [state('2026-08-18', 1), state('2026-08-19', 1), state('2026-08-20', 1)])
  assert.equal(getLatestState('ALB', '1d')?.bar_date, '2026-08-20')
  assert.deepEqual(getStates('ALB', '1d', 2).map(s => s.bar_date), ['2026-08-20', '2026-08-19'])
  assert.equal(getLatestState('ALB', '1wk'), null)
})

test('replaceStates 幂等:重复写入结果一致', () => {
  const rows = [state('2026-08-19', 1), state('2026-08-20', 1)]
  replaceStates('ALB', '1d', rows)
  replaceStates('ALB', '1d', rows)
  replaceStates('ALB', '1d', rows)
  assert.equal(getStates('ALB', '1d', 100).length, 2)
})

test('replaceStates 清掉不再出现的陈旧行', () => {
  replaceStates('ALB', '1d', [state('2026-08-18', 1), state('2026-08-19', 1), state('2026-08-20', 1)])
  // 改大 ATR 周期后输出点变少,最早那根不该留在库里
  replaceStates('ALB', '1d', [state('2026-08-19', -1), state('2026-08-20', -1)])
  const all = getStates('ALB', '1d', 100)
  assert.deepEqual(all.map(s => s.bar_date), ['2026-08-20', '2026-08-19'])
  assert.equal(all[0].trend, -1)
})

test('不同 timeframe 与不同 symbol 互不干扰', () => {
  replaceStates('ALB', '1d', [state('2026-08-20', 1)])
  replaceStates('ALB', '1wk', [state('2026-08-14', -1, { timeframe: '1wk' })])
  replaceStates('SQM', '1d', [state('2026-08-20', -1, { symbol: 'SQM' })])
  replaceStates('ALB', '1d', [state('2026-08-20', 1)])          // 重写 ALB 日线
  assert.equal(getLatestState('ALB', '1wk')?.bar_date, '2026-08-14')
  assert.equal(getLatestState('SQM', '1d')?.trend, -1)
})

test('事件:最新一条、区间计数、全局近期', () => {
  replaceEvents('ALB', '1d', [
    event('2026-02-02', -1), event('2026-04-14', 1),
    event('2026-05-18', -1), event('2026-08-07', 1),
  ])
  replaceEvents('SQM', '1d', [{ ...event('2026-08-19', -1), symbol: 'SQM' }])
  assert.equal(getLatestEvent('ALB', '1d')?.bar_date, '2026-08-07')
  assert.equal(countEventsSince('ALB', '1d', '2026-05-01'), 2)
  assert.equal(countEventsSince('ALB', '1d', '2026-01-01'), 4)
  assert.deepEqual(
    getRecentEvents('2026-08-01').map(e => `${e.symbol}:${e.bar_date}`),
    ['SQM:2026-08-19', 'ALB:2026-08-07'],     // 全局倒序
  )
})

test('空数组写入等于清空', () => {
  replaceStates('ALB', '1d', [state('2026-08-20', 1)])
  replaceStates('ALB', '1d', [])
  assert.equal(getLatestState('ALB', '1d'), null)
})
