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

export type TraceStatus = 'ok' | 'degraded' | 'error'

export interface TraceRecord {
  id: string
  route: string
  user_id: string | null
  status: TraceStatus
  duration_ms: number
  span_count: number
  degraded_count: number
  error_count: number
  started_at: string
  created_at: string
}

export interface SpanRecord {
  id: string
  trace_id: string
  parent_span_id: string | null
  name: string
  status: TraceStatus
  start_offset_ms: number
  duration_ms: number
  degraded_reason: string | null
  input: string | null
  output: string | null
  /** JSON 字符串 */
  metadata: string
  error_message: string | null
}

export interface WaterfallRow {
  span: SpanRecord
  depth: number
  leftPct: number
  widthPct: number
}

export type EvalStatus = 'none' | 'running' | 'done' | 'failed'

export interface EvalReportRow {
  doc_id: string
  filename: string
  status: EvalStatus
  question_count: number
  avg_recall: number | null
  avg_precision: number | null
  avg_faithfulness: number | null
  avg_relevancy: number | null
  finished_at: string | null
}

export interface EvalStats {
  docsEvaluated: number
  avgRecall: number
  avgPrecision: number
  avgFaithfulness: number
  avgRelevancy: number
}

export interface EvalResultRow {
  question: string
  expected: string
  retrieved_sections: string
  answer: string
  recall: number
  precision: number
  faithfulness: number
  relevancy: number
  reasoning: string
}
