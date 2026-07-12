export interface Document {
  id: string
  filename: string
  size_bytes: number
  chunk_count: number
  created_at: string
}
export interface Source {
  section_title: string
  section_slug: string
  chunk_index: number
}
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}
