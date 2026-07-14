// packages/server/src/routes/chat.ts
import type { FastifyPluginAsync } from 'fastify'
import { streamChat, PROVIDER } from '../llm.js'
import { searchChunks, isDocVectorAvailable } from '../services/documentVector.js'
import { getDocument } from '../services/documentStore.js'
import { runInTrace, withSpan, spanInput, spanOutput, spanMeta, markDegraded } from '../services/tracing.js'
import { requireUser } from './auth.js'
import { tryReserveMessage, refundMessage, MESSAGE_LIMIT } from '../services/userStore.js'
import { tryReserveGlobal, refundGlobal, GLOBAL_LIMIT } from '../services/usageStore.js'
import { appendMessage, getMessages } from '../services/chatStore.js'
import { buildSystemPrompt } from '../services/ragPrompt.js'
import type { LLMMessage, DocumentChunk } from '../types.js'

interface StreamBody {
  docId: string
  message: string
}

type SSE =
  | { sources: Array<{ section_title: string; section_slug: string; chunk_index: number }> }
  | { text: string }
  | { done: true }
  | { error: string }

function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 3)
}

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.get('/chat/health', async () => ({ status: 'ok', provider: PROVIDER }))

  app.get<{ Querystring: { docId?: string } }>('/chat/messages', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const docId = request.query.docId
    if (!docId) return reply.status(400).send({ error: 'docId is required' })
    const messages = getMessages(user.id, docId).map(r => ({
      role: r.role,
      content: r.content,
      sources: r.sources_json ? JSON.parse(r.sources_json) : undefined,
    }))
    return { messages }
  })

  app.post<{ Body: StreamBody }>('/chat/stream', async (request, reply) => {
    const { docId, message } = request.body ?? ({} as StreamBody)
    if (!docId) return reply.status(400).send({ error: 'docId is required' })
    if (!message?.trim()) return reply.status(400).send({ error: 'message is required' })
    if (!getDocument(docId)) return reply.status(404).send({ error: 'document not found' })

    const user = requireUser(request, reply)
    if (!user) return
    if (user.is_admin !== 1) {
      if (!tryReserveMessage(user.id)) {
        return reply.status(403).send({ error: 'message_limit_reached', scope: 'user', limit: MESSAGE_LIMIT })
      }
      if (!tryReserveGlobal()) {
        refundMessage(user.id)
        return reply.status(403).send({ error: 'message_limit_reached', scope: 'global', limit: GLOBAL_LIMIT })
      }
    }

    await runInTrace({ route: '/chat/stream', userId: null }, async () => {
      // 1) 检索
      const chunks: DocumentChunk[] = await withSpan('doc_retrieval', async () => {
        spanInput(message)
        const found = isDocVectorAvailable() ? await searchChunks(message, docId) : []
        if (!found.length) markDegraded('doc_retrieval_empty')
        spanMeta('kept', found.length)
        spanMeta('distances', found.map(c => Number(c.distance.toFixed(4))))
        spanMeta('sections', found.map(c => c.section_title))
        spanOutput(found.map(c => `[§${c.section_title}] ${c.content}`).join('\n\n'))
        return found
      })

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      const send = (p: SSE) => { try { reply.raw.write(`data: ${JSON.stringify(p)}\n\n`) } catch { /* client gone */ } }

      // 来源(去重章节)
      const seen = new Set<string>()
      const sources = chunks
        .filter(c => (seen.has(c.section_slug) ? false : (seen.add(c.section_slug), true)))
        .map(c => ({ section_title: c.section_title, section_slug: c.section_slug, chunk_index: c.chunk_index }))
      send({ sources })
      appendMessage(user.id, docId, { role: 'user', content: message })

      // 2) 组装 prompt
      const system = await withSpan('prompt_assembly', async () => {
        const finalSystem = buildSystemPrompt(chunks)
        spanMeta('chunkCount', chunks.length)
        spanMeta('finalTokens', estimateTokens(finalSystem))
        return finalSystem
      })

      const messages: LLMMessage[] = [{ role: 'user', content: message }]

      // 3) 生成
      await withSpan('llm_generation', async () => {
        spanMeta('provider', PROVIDER)
        const t0 = performance.now()
        let firstAt = 0
        let out = ''
        try {
          const stream = streamChat({ messages, system, tag: 'chat/stream' })
          for await (const text of stream) {
            if (!firstAt) { firstAt = performance.now(); spanMeta('ttfbMs', Math.round(firstAt - t0)) }
            out += text
            send({ text })
          }
          spanMeta('outputTokens', estimateTokens(out))
          spanOutput(out)
          appendMessage(user.id, docId, { role: 'assistant', content: out, sources })
          send({ done: true })
        } catch (err) {
          app.log.error(err)
          send({ error: err instanceof Error ? err.message : 'Unknown error' })
          throw err   // 让 withSpan 记为 error 状态
        } finally {
          try { reply.raw.end() } catch { /* already ended */ }
        }
      })
    }).catch(() => {
      // 生成链路任一步失败(检索/落库/组装/生成):退还本次预留的配额,失败不计数
      if (user.is_admin !== 1) { refundMessage(user.id); refundGlobal() }
    })
  })
}
