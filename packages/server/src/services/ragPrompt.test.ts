import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt, SYSTEM_BASE } from './ragPrompt.ts'
import type { DocumentChunk } from '../types.ts'

const chunk: DocumentChunk = {
  doc_id: 'doc',
  filename: '锂电.md',
  chunk_index: 0,
  content: '盐湖扩产。',
  distance: null,
  section_title: '供给',
  section_slug: '供给',
}

test('不传市场对照时,提示与评估用的旧版一致', () => {
  const prompt = buildSystemPrompt([chunk])
  assert.ok(prompt.startsWith(SYSTEM_BASE))
  assert.match(prompt, /盐湖扩产/)
  assert.doesNotMatch(prompt, /名家持仓/)
})

test('传入对照板块时,开场不再要求只看文档参考', () => {
  const prompt = buildSystemPrompt([chunk], '--- 相关信号与名家持仓 ---\nALB 日线多头')
  assert.match(prompt, /【来源:信号】/)
  assert.match(prompt, /【来源:名家持仓】/)
  assert.match(prompt, /信号和名家持仓只依据后面的「相关信号与名家持仓」/)
  assert.doesNotMatch(prompt, /只依据"文档参考"中的内容/)
  assert.ok(prompt.indexOf('盐湖扩产') < prompt.indexOf('ALB 日线多头'))
})
