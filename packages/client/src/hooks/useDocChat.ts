import { useState, useEffect } from 'react'
import type { ChatMessage, Source } from '../types'

export function useDocChat(docId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)

  useEffect(() => {
    let alive = true
    import('../api').then(({ api }) => api.getMessages(docId)).then(m => { if (alive && m.length) setMessages(m) })
    return () => { alive = false }
  }, [docId])

  function updateLast(fn: (m: ChatMessage) => ChatMessage) {
    setMessages(prev => {
      const next = [...prev]
      const i = next.length - 1
      if (i >= 0 && next[i].role === 'assistant') next[i] = fn(next[i])
      return next
    })
  }

  async function send(text: string) {
    if (!text.trim() || streaming) return
    setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setStreaming(true)
    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, message: text }),
      })
      if (!res.ok) {
        // /chat/stream 有几种错误在 SSE 流开始前就以普通 JSON 400/403 返回
        // (配置失效、baseURL 解析失败、限次耗尽等),这里必须先处理掉,
        // 不然会走到下面按 SSE 分片解析,导致气泡永远停在「…」。
        const body = await res.json().catch(() => null) as { error?: string; message?: string } | null
        const hint = body?.error === 'llm_config_invalid' || body?.error === 'invalid_base_url'
          ? '\n\n你自己的模型调用失败了,去「模型设置」检查 key 和模型名。'
          : ''
        const errText = body?.message || body?.error || '请求失败'
        updateLast(m => ({ ...m, content: `${m.content}\n\n[出错] ${errText}${hint}` }))
        return
      }
      if (!res.body) throw new Error('无响应流')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim()
          if (!line) continue
          const evt = JSON.parse(line) as
            | { sources: Source[] } | { text: string } | { done: true } | { error: string; code?: string }
          if ('sources' in evt) updateLast(m => ({ ...m, sources: evt.sources }))
          else if ('text' in evt) updateLast(m => ({ ...m, content: m.content + evt.text }))
          else if ('error' in evt) {
            const hint = evt.code === 'user_llm_failed'
              ? '\n\n你自己的模型调用失败了,去「模型设置」检查 key 和模型名。'
              : ''
            updateLast(m => ({ ...m, content: `${m.content}\n\n[出错] ${evt.error}${hint}` }))
          }
        }
      }
    } catch (err) {
      updateLast(m => ({ ...m, content: m.content + `\n\n[出错] ${err instanceof Error ? err.message : err}` }))
    } finally {
      setStreaming(false)
    }
  }

  return { messages, send, streaming }
}
