// packages/server/src/types.ts
export type MessageRole = 'user' | 'assistant'

export interface LLMMessage {
  role: MessageRole
  content: string
}

export type ProviderKind = 'openai' | 'anthropic'

/**
 * 一次生成调用要用的全部信息。streamChat 只认这个对象,不再读 process.env ——
 * 这样"用站长的 key"和"用用户的 key"走的是同一条代码路径。
 */
export interface LLMConfig {
  kind: ProviderKind
  /** 'zhipu' | 'anthropic' | 'custom' | … 仅用于展示与 trace */
  providerId: string
  /** anthropic 原生时为空(用 SDK 默认端点) */
  baseURL?: string
  /** 站长默认可多个(配额耗尽时依次 fallback);用户配置恒为 1 个 */
  models: string[]
  apiKey: string
  source: 'user' | 'server'
}

export interface StreamChatOptions {
  messages: LLMMessage[]
  config: LLMConfig
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
