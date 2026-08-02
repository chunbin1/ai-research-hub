import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import type { Document } from '../types'

export default function HomePage() {
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { user, login, logout } = useAuth()
  const isAdmin = user?.isAdmin === true

  const refresh = () => api.listDocuments().then(setDocs).catch(e => setError(String(e.message)))
  useEffect(() => { refresh().finally(() => setLoading(false)) }, [])

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
    <div className="mx-auto max-w-[1100px] px-4 py-5 md:px-6 md:py-8">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[24px] font-bold tracking-[2px]">研报站</h1>
        <div className="flex flex-wrap items-center gap-3.5">
          {isAdmin && (
            <Link to="/traces" className="rounded-lg border border-[#e0e0e0] px-3 py-2 text-[14px] text-[#555] hover:bg-[#f3f3f0] hover:text-black">
              🔍 trace
            </Link>
          )}
          {isAdmin && (
            <Link to="/eval" className="rounded-lg border border-[#e0e0e0] px-3 py-2 text-[14px] text-[#555] hover:bg-[#f3f3f0] hover:text-black">
              📊 评估
            </Link>
          )}
          {isAdmin && (
            <label className="cursor-pointer rounded-lg bg-[#1a1a1a] px-4 py-[9px] text-[14px] text-white">
              {uploading ? '上传中…' : '+ 上传研报 (.md)'}
              <input ref={fileRef} type="file" accept=".md,.markdown,.txt" onChange={onFile} hidden />
            </label>
          )}
          {user ? (
            <span className="flex items-center gap-2 text-[14px]">
              {user.avatarUrl && <img className="h-[26px] w-[26px] rounded-full" src={user.avatarUrl} alt="" />}
              <span className="text-[#333]">{user.username}</span>
              {!user.unlimited && (
                <span className="rounded-full border border-gold-edge bg-gold-wash px-2 py-0.5 text-[12px] text-gold-ink">
                  剩余 {user.remaining}
                </span>
              )}
              <button
                className="cursor-pointer rounded-lg border border-[#ddd] bg-white px-3 py-[7px] text-[14px] hover:bg-[#f3f3f0]"
                onClick={() => void logout()}
              >
                登出
              </button>
            </span>
          ) : (
            <button
              className="cursor-pointer rounded-lg border border-[#1a1a1a] bg-[#1a1a1a] px-3 py-[7px] text-[14px] text-white"
              onClick={login}
            >
              GitHub 登录
            </button>
          )}
        </div>
      </header>

      {error && <div className="mb-4 text-danger">{error}</div>}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {loading && Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-xl border border-[#ececec] bg-white p-5" aria-hidden>
            <div className="mb-4 h-[17px] w-4/5 animate-skeleton rounded-md bg-[#eee] motion-reduce:animate-none" />
            <div className="h-[13px] w-[45%] animate-skeleton rounded-md bg-[#eee] motion-reduce:animate-none" />
          </div>
        ))}
        {!loading && docs.map(d => (
          <article
            key={d.id}
            className="group relative cursor-pointer rounded-xl border border-[#ececec] bg-white p-5 transition-[box-shadow,transform] duration-150 ease-[ease] hover:-translate-y-0.5 hover:shadow-[0_6px_24px_rgba(0,0,0,.08)] motion-reduce:transition-none"
            onClick={() => navigate(`/reports/${d.id}`)}
          >
            <h2 className="mb-3 text-[17px] font-bold leading-[1.4]">{d.filename}</h2>
            <div className="flex gap-3 text-[13px] text-[#888]">
              <span>{new Date(d.created_at).toLocaleDateString('zh-CN')}</span>
              <span>{d.chunk_count} 段</span>
            </div>
            {/* 触屏没有 hover:移动端常显,桌面维持「悬停才出现」的原样 */}
            {isAdmin && (
              <button
                className="absolute right-3.5 top-3.5 cursor-pointer text-[12px] text-danger opacity-100 md:opacity-0 md:group-hover:opacity-100"
                onClick={e => onDelete(e, d.id)}
              >
                删除
              </button>
            )}
          </article>
        ))}
        {!loading && docs.length === 0 && (
          <p className="col-span-full py-15 text-center text-[#999]">还没有报告。</p>
        )}
      </div>
    </div>
  )
}
