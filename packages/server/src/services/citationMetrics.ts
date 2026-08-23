// packages/server/src/services/citationMetrics.ts
//
// 引用覆盖率:塞进 prompt 的章节里,模型在答案中实际点名引用了多少。
//
// 信号是白捡的 —— ragPrompt 的规则第三条已经要求模型用【来源:§章节名】标注,
// 模型一直在照做,只是从来没有代码读过它。这里把它数出来。
//
// ⚠️ 这是「上下文利用率」的**代理指标**,不是硬测量:
//   - 模型用了某块却忘了标来源 → 低估(线上确实出现过:答出了具体数字,coverage 却是 0)
//   - 模型标了来源却没真用     → 高估
//   - 遵守率随模型而变,BYOK 用户换模型后**跨模型不可比**
// 因此它只适合在**固定模型**下做改动前后的纵向对比,不要当绝对值读,
// 更不要拿去横向比较不同模型。

import type { DocumentChunk } from '../types.js'

export interface CitationStats {
  /** 塞进 prompt 的块数(不去重) */
  promptChunks: number
  /** 塞进 prompt 的章节数(去重) —— coverage 的分母 */
  promptSections: number
  /** 答案中引用且能匹配上的章节数(去重) —— coverage 的分子 */
  citedSections: number
  /** 引用了但 prompt 里根本没有的章节名 —— 模型编造来源的直接证据 */
  citedUnknown: string[]
  /** citedSections / promptSections;没有任何候选时为 null(不适用),而非 0 */
  coverage: number | null
}

// 半角/全角冒号都收;§ 可有可无。
const CITE_RE = /【来源[:：]\s*§?\s*([^】]+)】/g

/**
 * 去掉空白与标点后比对。模型会改写标点 —— 线上出现过把原文的全角双引号
 * “生意特征” 写成半角单引号 '生意特征',严格比对会把这次引用判成没引用。
 */
function normalize(s: string): string {
  return s.replace(/[\s\p{P}]/gu, '').toLowerCase()
}

/**
 * 把一个引用名解析到实际章节:先精确,再前缀。
 *
 * 前缀是必需的 —— 模型会把括号后缀截掉:prompt 里是
 * 「1.2 重大事件编年（Timeline）」,答案里只写「1.2 重大事件编年」。
 * 只做精确匹配会把它误判成编造来源,coverage 被错误归零。
 *
 * 前缀撞上多个章节时取最短的那个:结果与 chunk 顺序无关,且不会把一次引用
 * 算成命中多个章节(那样会虚高 coverage)。
 */
function resolveSection(citedKey: string, sectionKeys: string[]): string | null {
  // 空字符串是任何字符串的前缀,不加这道闸会让空标注白捡一个命中。
  if (!citedKey) return null
  if (sectionKeys.includes(citedKey)) return citedKey
  const prefixed = sectionKeys.filter(k => k.startsWith(citedKey))
  if (prefixed.length === 0) return null
  return prefixed.reduce((a, b) => (b.length < a.length ? b : a))
}

export function analyzeCitations(answer: string, chunks: DocumentChunk[]): CitationStats {
  // 空标题在 buildSystemPrompt 里显示为「引言」,这里必须用同一套显示名,
  // 否则模型引用「引言」会被误判成编造。
  const sectionKeys = [...new Set(chunks.map(c => normalize(c.section_title || '引言')))]

  const cited = new Set([...answer.matchAll(CITE_RE)].map(m => m[1].trim()))
  const matched = new Set<string>()
  const citedUnknown: string[] = []
  for (const name of cited) {
    const hit = resolveSection(normalize(name), sectionKeys)
    if (hit === null) citedUnknown.push(name)
    else matched.add(hit)
  }

  return {
    promptChunks: chunks.length,
    promptSections: sectionKeys.length,
    citedSections: matched.size,
    citedUnknown,
    coverage: sectionKeys.length === 0 ? null : matched.size / sectionKeys.length,
  }
}
