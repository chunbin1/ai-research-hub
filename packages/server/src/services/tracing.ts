// 首版不做分布式追踪;仅提供 llm.ts / documentVector.ts 引用的 markDegraded 空实现。
export function markDegraded(_reason?: string, _meta?: unknown): void {
  /* no-op */
}
