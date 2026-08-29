// packages/server/src/services/evalGenerator.ts
import OpenAI from 'openai'
import { readRawMarkdown } from './documentStore.js'
import { parseMarkdown } from './markdownParser.js'
import { throttledCompletion } from './llmThrottle.js'
import { logLlmRequest } from '../llmLog.js'

const MODEL = (process.env.ZHIPU_MODEL ?? 'glm-4.7-flash').split(',')[0].trim()

function getClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.ZHIPU_API_KEY, baseURL: 'https://open.bigmodel.cn/api/paas/v4/' })
}

export interface GeneratedCase {
  question: string
  expected_answer: string
  ground_truth_chunk_id: string
}

function buildPrompt(chunkContent: string): string {
  return `你是 RAG 评估数据集生成器。基于以下研报片段,生成 1 个用户可能提问的问题及其答案。
要求:
- 问题答案必须能从该片段中找到
- 问题自然、口语化,偏事实型(数字/时间/结论/规则)
- 严格输出单个 JSON 对象,不要任何额外文字

片段:
"""
${chunkContent}
"""

输出格式(合法 JSON):
{"question": "...", "expected_answer": "..."}`
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

/** 洗牌取前 n(Fisher–Yates)。 */
function sample<T>(arr: T[], n: number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, Math.min(n, a.length))
}

/** 抽样 sampleSize 个分块,每块生成 1 题;返回内存 cases(不落库)。 */
export async function generateSampledCases(docId: string, sampleSize: number): Promise<GeneratedCase[]> {
  const md = readRawMarkdown(docId)
  if (!md) return []
  const { chunks } = parseMarkdown(md)
  // 只取有足够内容的块(避免拿标题/空块出题)
  const usable = chunks.filter(c => c.content.trim().length >= 40)
  const picked = sample(usable, sampleSize)

  const out: GeneratedCase[] = []
  for (const c of picked) {
    const prompt = buildPrompt(c.content)
    logLlmRequest('eval/generate', { model: MODEL, messages: [{ role: 'user', content: prompt }] })
    try {
      const completion = await throttledCompletion(() =>
        getClient().chat.completions.create({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        }),
      )
      const raw = completion.choices[0]?.message?.content ?? ''
      const parsed = JSON.parse(stripFences(raw)) as { question?: unknown; expected_answer?: unknown }
      if (typeof parsed.question === 'string' && typeof parsed.expected_answer === 'string') {
        out.push({
          question: parsed.question,
          expected_answer: parsed.expected_answer,
          ground_truth_chunk_id: `${docId}_chunk_${c.chunk_index}`,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[eval/generate] 出题失败(块 ${c.chunk_index}): ${msg}`)
      // 单块失败跳过,不阻断整篇
    }
  }
  return out
}
