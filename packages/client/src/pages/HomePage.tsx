import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api'
import type { Document } from '../types'
import styles from './HomePage.module.css'

export default function HomePage() {
  const [docs, setDocs] = useState<Document[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const refresh = () => api.listDocuments().then(setDocs).catch(e => setError(String(e.message)))
  useEffect(() => { refresh() }, [])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    try { await api.uploadDocument(file); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : '上传失败') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function onDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm('删除这篇报告?')) return
    await api.deleteDocument(id); await refresh()
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>研报站</h1>
        <div className={styles.headerRight}>
          <Link to="/traces" className={styles.traceLink}>🔍 trace</Link>
          <label className={styles.upload}>
            {uploading ? '上传中…' : '+ 上传研报 (.md)'}
            <input ref={fileRef} type="file" accept=".md,.markdown,.txt" onChange={onFile} hidden />
          </label>
        </div>
      </header>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.grid}>
        {docs.map(d => (
          <article key={d.id} className={styles.card} onClick={() => navigate(`/reports/${d.id}`)}>
            <h2 className={styles.title}>{d.filename}</h2>
            <div className={styles.meta}>
              <span>{new Date(d.created_at).toLocaleDateString('zh-CN')}</span>
              <span>{d.chunk_count} 段</span>
            </div>
            <button className={styles.del} onClick={e => onDelete(e, d.id)}>删除</button>
          </article>
        ))}
        {docs.length === 0 && <p className={styles.empty}>还没有报告,点右上角上传一篇 markdown 研报。</p>}
      </div>
    </div>
  )
}
