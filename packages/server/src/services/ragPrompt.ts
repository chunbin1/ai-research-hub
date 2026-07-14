// packages/server/src/services/ragPrompt.ts
import type { DocumentChunk } from '../types.js'

export const SYSTEM_BASE = `你是投研报告阅读助手。只依据"文档参考"中的内容回答用户关于当前这篇研报的问题。
规则:
- 严格基于文档参考,不要编造数字或结论;文档中没有的,明确说"报告中未提及"。
- 回答用中文,简洁、分点。
- 在引用具体结论时,用【来源:§章节名】标注它出自哪一节(章节名取文档参考中给出的)。`

/** 与线上 /chat/stream 完全一致的 system prompt 拼装,供聊天与评估共用。 */
export function buildSystemPrompt(chunks: DocumentChunk[]): string {
  const docSection = chunks.length
    ? chunks.map(c => `[§${c.section_title || '引言'}] ${c.content}`).join('\n\n')
    : '(未检索到相关段落)'
  return `${SYSTEM_BASE}\n\n--- 文档参考 ---\n${docSection}`
}
