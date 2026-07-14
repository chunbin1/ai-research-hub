import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreContextRecall } from './evalJudge.ts'

test('命中 ground truth chunk_id → 1', () => {
  assert.equal(scoreContextRecall(['d_chunk_0', 'd_chunk_3'], 'd_chunk_3'), 1)
})

test('未命中 chunk_id 但期望答案「完整」出现在检索块 → 1', () => {
  // docmind 版要求期望答案整体作为子串出现(去标点/空白后),这里检索块含完整的「周期由供给主导」
  assert.equal(
    scoreContextRecall(['d_chunk_1'], 'd_chunk_9', '周期由供给主导', ['报告指出:周期由供给主导,而非需求。']),
    1,
  )
})

test('期望答案只部分出现(缺字)→ 0', () => {
  // 检索块只有「由供给主导」,缺「周期」,完整答案未出现 → 不算召回
  assert.equal(
    scoreContextRecall(['d_chunk_1'], 'd_chunk_9', '周期由供给主导', ['价格暴涨暴跌由供给主导造成']),
    0,
  )
})

test('都不满足 → 0', () => {
  assert.equal(scoreContextRecall(['d_chunk_1'], 'd_chunk_9', '完全不相关的答案', ['别的内容']), 0)
})

test('过短期望答案不做包含匹配(避免误判)', () => {
  assert.equal(scoreContextRecall(['d_chunk_1'], 'd_chunk_9', '锂', ['锂电池产业链']), 0)
})
