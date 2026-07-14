// packages/server/src/services/evalRunner.ts
import OpenAI from 'openai'
import { generateSampledCases } from './evalGenerator.js'
import { searchChunks } from './documentVector.js'
import { buildSystemPrompt } from './ragPrompt.js'
import { scoreContextRecall, scoreLLMMetrics } from './evalJudge.js'
import { throttledCompletion } from './llmThrottle.js'
import { setQuestionCount, insertResult, finishRun, failRun } from './evalStore.js'
import { logLlmRequest } from '../llmLog.js'

export const EVAL_SAMPLE_SIZE = Number(process.env.EVAL_SAMPLE_SIZE) || 15
const MODEL = (process.env.ZHIPU_MODEL ?? 'glm-4.7').split(',')[0].trim()

function getClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.ZHIPU_API_KEY, baseURL: 'https://open.bigmodel.cn/api/paas/v4/' })
}

/** 用与线上一致的 system prompt + 检索块生成答案(throttled 非流式)。 */
async function answer(question: string, system: string): Promise<string> {
  logLlmRequest('eval/answer', { model: MODEL, system, messages: [{ role: 'user', content: question }] })
  try {
    const completion = await throttledCompletion(() =>
      getClient().chat.completions.create({
        model: MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: question }],
        temperature: 0.2,
      }),
    )
    return completion.choices[0]?.message?.content ?? ''
  } catch (err) {
    return `[生成失败: ${err instanceof Error ? err.message : String(err)}]`
  }
}

/**
 * 异步跑一篇评估(fire-and-forget):抽样出题 → 逐题(同线上检索+答题)→ 四维打分 →
 * 汇总。任何失败都 failRun 并静默返回,绝不抛回调用方(路由已立即响应)。
 */
export async function runEval(docId: string, runId: string): Promise<void> {
  try {
    const cases = await generateSampledCases(docId, EVAL_SAMPLE_SIZE)
    if (cases.length === 0) { failRun(runId); return }
    setQuestionCount(runId, cases.length)

    let cr = 0, cp = 0, f = 0, ar = 0
    for (const c of cases) {
      const chunks = await searchChunks(c.question, docId)         // 同线上检索
      const retrievedIds = chunks.map(rc => `${docId}_chunk_${rc.chunk_index}`)
      const ans = await answer(c.question, buildSystemPrompt(chunks)) // 同线上 prompt
      const recall = scoreContextRecall(retrievedIds, c.ground_truth_chunk_id, c.expected_answer, chunks.map(rc => rc.content))
      const m = await scoreLLMMetrics(c.question, chunks, ans, c.expected_answer)
      insertResult(runId, {
        question: c.question,
        expected: c.expected_answer,
        retrieved_sections: JSON.stringify(chunks.map(rc => rc.section_title)),
        answer: ans,
        recall,
        precision: m.precision.score,
        faithfulness: m.faithfulness.score,
        relevancy: m.relevancy.score,
        reasoning: JSON.stringify({ precision: m.precision.reasoning, faithfulness: m.faithfulness.reasoning, relevancy: m.relevancy.reasoning }),
      })
      cr += recall; cp += m.precision.score; f += m.faithfulness.score; ar += m.relevancy.score
    }
    const n = cases.length
    finishRun(runId, { recall: cr / n, precision: cp / n, faithfulness: f / n, relevancy: ar / n })
  } catch (err) {
    console.error(`[eval] run ${runId} 失败: ${err instanceof Error ? err.message : String(err)}`)
    failRun(runId)
  }
}
