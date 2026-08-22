import type { Document } from './types'

export const api = {
  async listDocuments(): Promise<Document[]> {
    const r = await fetch('/api/documents')
    if (!r.ok) throw new Error('列表加载失败')
    return (await r.json()).documents
  },
  async getDocument(id: string): Promise<{ document: Document; markdown: string }> {
    const r = await fetch(`/api/documents/${id}`)
    if (!r.ok) throw new Error('报告加载失败')
    return r.json()
  },
  async uploadDocument(file: File): Promise<Document> {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch('/api/documents', { method: 'POST', body: fd })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? '上传失败')
    return (await r.json()).document
  },
  async deleteDocument(id: string): Promise<void> {
    const r = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error('删除失败')
  },
  async getMessages(docId: string): Promise<import('./types').ChatMessage[]> {
    const r = await fetch(`/api/chat/messages?docId=${encodeURIComponent(docId)}`)
    if (!r.ok) return []
    return (await r.json()).messages
  },
  async listSignals(): Promise<import('./types').SignalRow[]> {
    const r = await fetch('/api/signals')
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '看板加载失败')
    return (await r.json()).rows
  },
  async scanSignals(): Promise<import('./types').ScanSummary> {
    const r = await fetch('/api/signals/scan', { method: 'POST' })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '扫描失败')
    return (await r.json()).summary
  },
  async extractWatchlist(): Promise<{ documents: number; symbols: string[] }> {
    const r = await fetch('/api/signals/extract', { method: 'POST' })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '抽取失败')
    return r.json()
  },
  async setWatchlistEnabled(symbol: string, enabled: boolean): Promise<void> {
    const r = await fetch(`/api/signals/watchlist/${encodeURIComponent(symbol)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '操作失败')
  },
  async getSignalLog(symbol: string, timeframe: '1d' | '1wk', limit = 60): Promise<import('./types').SignalStateRow[]> {
    const r = await fetch(`/api/signals/${encodeURIComponent(symbol)}/log?timeframe=${timeframe}&limit=${limit}`)
    if (!r.ok) throw new Error('日志加载失败')
    // 响应体缺 states 字段时兜底为空数组,避免把整页打挂
    return (await r.json()).states ?? []
  },
  async listSignalEvents(days = 7): Promise<import('./types').SignalEventRow[]> {
    const r = await fetch(`/api/signals/events?days=${days}`)
    if (!r.ok) throw new Error('事件加载失败')
    // 响应体缺 events 字段时兜底为空数组,避免把整页打挂
    return (await r.json()).events ?? []
  },
}
