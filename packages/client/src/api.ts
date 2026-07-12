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
}
