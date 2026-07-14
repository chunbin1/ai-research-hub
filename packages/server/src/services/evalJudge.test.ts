import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreContextRecall } from './evalJudge.ts'

test('命中 ground truth chunk_id → 1', () => {
  assert.equal(scoreContextRecall(['d_chunk_0', 'd_chunk_3'], 'd_chunk_3'), 1)
})

test('未命中 chunk_id 但期望答案文本出现在检索块 → 1', () => {
  assert.equal(
    scoreContextRecall(['d_chunk_1'], 'd_chunk_9', '周期由供给主导', ['……价格暴涨暴跌由供给主导造成……']),
    1,
  )
})

test('都不满足 → 0', () => {
  assert.equal(scoreContextRecall(['d_chunk_1'], 'd_chunk_9', '完全不相关的答案', ['别的内容']), 0)
})

test('过短期望答案不做包含匹配(避免误判)', () => {
  assert.equal(scoreContextRecall(['d_chunk_1'], 'd_chunk_9', '锂', ['锂电池产业链']), 0)
})
