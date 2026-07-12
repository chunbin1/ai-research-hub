import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initTraceTables, listTraces, getTrace } from './traceStore.ts'
import { runInTrace, withSpan, spanMeta, markDegraded } from './tracing.ts'

test('runInTrace + withSpan 落库,可查回带 metadata 与降级状态', async () => {
  const db = new Database(':memory:')
  initTraceTables(db)

  await runInTrace({ route: '/chat/stream', userId: null }, async () => {
    await withSpan('doc_retrieval', async () => {
      spanMeta('kept', 3)
      markDegraded('doc_retrieval_minK', { topDistance: 0.71 })
    })
    await withSpan('llm_generation', async () => {
      spanMeta('provider', 'zhipu')
    })
  })

  const traces = listTraces({})
  assert.equal(traces.length, 1)
  assert.equal(traces[0].route, '/chat/stream')
  assert.equal(traces[0].status, 'degraded')      // markDegraded 上卷
  assert.equal(traces[0].span_count, 2)

  const detail = getTrace(traces[0].id)!
  assert.equal(detail.spans.length, 2)
  const ret = detail.spans.find(s => s.name === 'doc_retrieval')!
  assert.equal(ret.status, 'degraded')
  assert.equal(ret.degraded_reason, 'doc_retrieval_minK')
  assert.ok(ret.metadata.includes('kept'))
})
