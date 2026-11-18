// packages/server/src/services/ragPrompt.ts
import type { DocumentChunk } from '../types.js'

export const SYSTEM_BASE = `你是投研报告阅读助手。只依据"文档参考"中的内容回答用户关于当前这篇研报的问题。
规则:
- 严格基于文档参考,不要编造数字或结论;文档中没有的,明确说"报告中未提及"。
- 回答用中文,简洁、分点。
- 在引用具体结论时,用【来源:§章节名】标注它出自哪一节(章节名取文档参考中给出的)。`

/** 有对照块时换掉 SYSTEM_BASE 的开场。评估不传 market,仍用上面那段。 */
const SYSTEM_WITH_MARKET = `你是投研报告阅读助手。用户在问当前这篇研报。研报里的数字和结论只依据"文档参考";信号和名家持仓只依据后面的「相关信号与名家持仓」。
规则:
- 文档参考里没有的研报结论,明确说"报告中未提及",不要用对照块里的数字冒充研报原文。
- 回答用中文,简洁、分点。
- 引用研报结论时,用【来源:§章节名】标注它出自哪一节(章节名取文档参考中给出的)。`

const MARKET_RULES = `信号和名家持仓是另外两块事实,只能用「相关信号与名家持仓」里写出的内容:
- 不要把它们说成研报里的结论。引用信号时用【来源:信号】,引用名家持仓时用【来源:名家持仓】。
- 只讨论板块里列出的代码。用户问到没列出的代码时,说明这次只对照了本篇研报标题里的代码,不要说成"没有人持有"或"没有信号"。`

/**
 * 拼 system prompt。
 * 不传 market 时与评估用的旧提示一致,只含研报段落。
 * 线上提问会传入「相关信号与名家持仓」,并多两条引用规则。
 */
export function buildSystemPrompt(chunks: DocumentChunk[], market?: string): string {
  const docSection = chunks.length
    ? chunks.map(c => `[§${c.section_title || '引言'}] ${c.content}`).join('\n\n')
    : '(未检索到相关段落)'
  const extra = market?.trim()
  const base = extra ? `${SYSTEM_WITH_MARKET}\n${MARKET_RULES}` : SYSTEM_BASE
  const tail = extra ? `\n\n${extra}` : ''
  return `${base}\n\n--- 文档参考 ---\n${docSection}${tail}`
}
