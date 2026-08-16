import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NodeIndexOutlined, BarChartOutlined, SettingOutlined, RobotOutlined } from '@ant-design/icons'
import { Avatar, Button, Empty, Modal, Upload } from 'antd'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import type { Document } from '../types'

export default function HomePage() {
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { user, login, logout } = useAuth()
  const isAdmin = user?.isAdmin === true

  const refresh = () => api.listDocuments().then(setDocs).catch(e => setError(String(e.message)))
  useEffect(() => { refresh().finally(() => setLoading(false)) }, [])

  async function handleUpload(file: File) {
    setUploading(true); setError('')
    try { await api.uploadDocument(file); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : '上传失败') }
    finally { setUploading(false) }
  }

  async function onDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    Modal.confirm({
      title: '删除这篇报告?',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => { await api.deleteDocument(id); await refresh() },
    })
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 md:px-6 md:py-8">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[24px] font-bold tracking-[2px]">研报站</h1>
        <div className="flex flex-wrap items-center gap-3.5">
          {isAdmin && (
            <Button icon={<RobotOutlined aria-hidden />} onClick={() => navigate('/admin')}>站点模型</Button>
          )}
          {isAdmin && (
            <Button icon={<NodeIndexOutlined aria-hidden />} onClick={() => navigate('/traces')}>trace</Button>
          )}
          {isAdmin && (
            <Button icon={<BarChartOutlined aria-hidden />} onClick={() => navigate('/eval')}>评估</Button>
          )}
          {isAdmin && (
            <Upload
              accept=".md,.markdown,.txt"
              showUploadList={false}
              beforeUpload={file => { void handleUpload(file); return false }}
            >
              <Button type="primary" loading={uploading}>
                {uploading ? '上传中…' : '+ 上传研报 (.md)'}
              </Button>
            </Upload>
          )}
          {user && (
            <Button icon={<SettingOutlined aria-hidden />} onClick={() => navigate('/settings')}>模型</Button>
          )}
          {user ? (
            <span className="flex items-center gap-2 text-[14px]">
              {user.avatarUrl
                ? <Avatar size={26} src={user.avatarUrl} />
                : <Avatar size={26}>{user.username.slice(0, 1).toUpperCase()}</Avatar>}
              <span className="text-[#333]">{user.username}</span>
              {!user.unlimited && (
                <span className="rounded-full border border-gold-edge bg-gold-wash px-2 py-0.5 text-[12px] text-gold-ink">
                  剩余 {user.remaining}
                </span>
              )}
              <Button onClick={() => void logout()}>登出</Button>
            </span>
          ) : (
            <Button type="primary" onClick={login}>GitHub 登录</Button>
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
          <div className="col-span-full py-15">
            <Empty description="还没有研报" />
          </div>
        )}
      </div>
    </div>
  )
}
