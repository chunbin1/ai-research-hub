import { test, expect } from 'vitest'
import { buildWaterfall } from './waterfall'
import type { SpanRecord } from '../types'

function span(p: Partial<SpanRecord>): SpanRecord {
  return {
    id: 'sp', trace_id: 'tr', parent_span_id: null, name: 'x',
    status: 'ok', start_offset_ms: 0, duration_ms: 0,
    degraded_reason: null, input: null, output: null,
    metadata: '{}', error_message: null, ...p,
  }
}

test('单个根 span:depth=0,按 total 计算百分比', () => {
  const rows = buildWaterfall([span({ id: 'a', start_offset_ms: 0, duration_ms: 50 })], 100)
  expect(rows.length).toBe(1)
  expect(rows[0].depth).toBe(0)
  expect(rows[0].leftPct).toBe(0)
  expect(rows[0].widthPct).toBe(50)
})

test('子 span:depth 随 parent 链递增', () => {
  const spans = [
    span({ id: 'a', start_offset_ms: 0, duration_ms: 100 }),
    span({ id: 'b', parent_span_id: 'a', start_offset_ms: 10, duration_ms: 20 }),
    span({ id: 'c', parent_span_id: 'b', start_offset_ms: 12, duration_ms: 5 }),
  ]
  const rows = buildWaterfall(spans, 100)
  expect(rows[1].depth).toBe(1)
  expect(rows[1].leftPct).toBe(10)
  expect(rows[2].depth).toBe(2)
})

test('totalMs<=0 回退到 max(offset+duration)', () => {
  const rows = buildWaterfall([
    span({ id: 'a', start_offset_ms: 0, duration_ms: 40 }),
    span({ id: 'b', start_offset_ms: 60, duration_ms: 40 }),
  ], 0)
  expect(rows[1].leftPct).toBe(60)
  expect(rows[1].widthPct).toBe(40)
})

test('duration_ms=0 给最小可见宽度', () => {
  const rows = buildWaterfall([span({ id: 'a', start_offset_ms: 10, duration_ms: 0 })], 100)
  expect(rows[0].widthPct).toBe(0.5)
})

test('空数组返回空数组', () => {
  expect(buildWaterfall([], 100)).toEqual([])
})
