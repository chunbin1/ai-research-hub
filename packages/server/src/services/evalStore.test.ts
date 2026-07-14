import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initEvalTables, createRun, setQuestionCount, insertResult, finishRun,
  getLatestRunByDoc, getResults, hasRunningRun, aggregateStats, markStaleRunsFailed,
} from './evalStore.ts'

test('run 生命周期 + 最新 run + 聚合', () => {
  const db = new Database(':memory:')
  initEvalTables(db)

  const runId = createRun('docA')
  assert.equal(hasRunningRun('docA'), true)
  setQuestionCount(runId, 2)
  insertResult(runId, { question: 'q1', expected: 'e1', retrieved_sections: '["§1"]', answer: 'a1', recall: 1, precision: 0.5, faithfulness: 1, relevancy: 1, reasoning: '{}' })
  insertResult(runId, { question: 'q2', expected: 'e2', retrieved_sections: '[]', answer: 'a2', recall: 0, precision: 0, faithfulness: 0.5, relevancy: 0.5, reasoning: '{}' })
  finishRun(runId, { recall: 0.5, precision: 0.25, faithfulness: 0.75, relevancy: 0.75 })

  assert.equal(hasRunningRun('docA'), false)
  const latest = getLatestRunByDoc('docA')!
  assert.equal(latest.status, 'done')
  assert.equal(latest.question_count, 2)
  assert.equal(latest.avg_recall, 0.5)
  assert.equal(getResults(runId).length, 2)

  const stats = aggregateStats()
  assert.equal(stats.docsEvaluated, 1)
  assert.equal(stats.avgRecall, 0.5)
})

test('markStaleRunsFailed 把 running 翻 failed', () => {
  const db = new Database(':memory:')
  initEvalTables(db)
  createRun('docB')
  markStaleRunsFailed()
  assert.equal(hasRunningRun('docB'), false)
  assert.equal(getLatestRunByDoc('docB')!.status, 'failed')
})
