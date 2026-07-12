// packages/server/src/routes/chat.ts
import type { FastifyPluginAsync } from 'fastify'
import { streamChat, PROVIDER } from '../llm.js'
import { searchChunks, isDocVectorAvailable } from '../services/documentVector.js'
import { getDocument } from '../services/documentStore.js'
import type { LLMMessage } from '../types.js'

const SYSTEM_BASE = `你是投研报告阅读助手。只依据"文档参考"中的内容回答用户关于当前这篇研报的问题。
规则:
- 严格基于文档参考,不要编造数字或结论;文档中没有的,明确说"报告中未提及"。
- 回答用中文,简洁、分点。
- 在引用具体结论时,用【来源:§章节名】标注它出自哪一节(章节名取文档参考中给出的)。`

interface StreamBody {
  docId: string
  message: string
}

type SSE =
  | { sources: Array<{ section_title: string; section_slug: string; chunk_index: number }> }
  | { text: string }
  | { done: true }
  | { error: string }

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.get('/chat/health', async () => ({ status: 'ok', provider: PROVIDER }))

  app.post<{ Body: StreamBody }>('/chat/stream', async (request, reply) => {
    const { docId, message } = request.body ?? ({} as StreamBody)
    if (!docId) return reply.status(400).send({ error: 'docId is required' })
    if (!message?.trim()) return reply.status(400).send({ error: 'message is required' })
    if (!getDocument(docId)) return reply.status(404).send({ error: 'document not found' })

    const chunks = isDocVectorAvailable() ? await searchChunks(message, docId) : []

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send = (p: SSE) => { try { reply.raw.write(`data: ${JSON.stringify(p)}\n\n`) } catch { /* client gone */ } }

    // 先把来源发给前端(去重章节)
    const seen = new Set<string>()
    const sources = chunks
      .filter(c => (seen.has(c.section_slug) ? false : (seen.add(c.section_slug), true)))
      .map(c => ({ section_title: c.section_title, section_slug: c.section_slug, chunk_index: c.chunk_index }))
    send({ sources })

    const docSection = chunks.length
      ? chunks.map(c => `[§${c.section_title || '引言'}] ${c.content}`).join('\n\n')
      : '(未检索到相关段落)'
    const system = `${SYSTEM_BASE}\n\n--- 文档参考 ---\n${docSection}`
    const messages: LLMMessage[] = [{ role: 'user', content: message }]

    try {
      const stream = streamChat({ messages, system, tag: 'chat/stream' })
      for await (const text of stream) send({ text })
      send({ done: true })
    } catch (err) {
      app.log.error(err)
      send({ error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      try { reply.raw.end() } catch { /* already ended */ }
    }
  })
}
