// packages/server/src/types.ts
export type LLMProvider = 'anthropic' | 'zhipu'
export type MessageRole = 'user' | 'assistant'

export interface LLMMessage {
  role: MessageRole
  content: string
}

export interface StreamChatOptions {
  messages: LLMMessage[]
  system?: string
  maxTokens?: number
  tag?: string
  signal?: AbortSignal
  onReasoning?: (delta: string) => void
}

/** SQLite documents 行 */
export interface Document {
  id: string
  filename: string       // 展示名(去扩展名)
  size_bytes: number
  chunk_count: number
  created_at: string
}

/** 从 ChromaDB 检索出的一个块(含章节信息,用于溯源) */
export interface DocumentChunk {
  doc_id: string
  filename: string
  chunk_index: number
  content: string
  distance: number
  section_title: string
  section_slug: string
}
