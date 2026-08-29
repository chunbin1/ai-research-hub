import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DownOutlined, UploadOutlined } from '@ant-design/icons'
import { Avatar, Dropdown, Modal, Upload } from 'antd'
import type { MenuProps } from 'antd'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import type { Document } from '../types'

/**
 * 首页 —— 按 design_handoff_homepage 的设计稿重建:纸感底色、衬线中文标题,
 * 以分隔线和留白代替卡片堆砌,研报列表是页面唯一重心。
 *
 * 桌面(≥1024)/ 平板(768–1023)/ 移动(<768)三档全部走 Tailwind 断点,
 * 不用 useIsMobile —— 那个 hook 按约定只服务行为差异,布局差异一律交给 md:/lg:。
 * 移动端与桌面端结构不同的几处(日期的位置、「阅读 ›」)用
 * hidden / md:hidden 切换同一份 DOM,display:none 的分支读屏不会重复播报。
 */

interface NavItem {
  label: string
  to: string
  /** 与改版前一致:评估 / 站点模型 / trace 只对管理员开放 */
  adminOnly: boolean
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: '研报', to: '/', adminOnly: false },
  { label: '信号', to: '/signals', adminOnly: false },
  { label: '评估', to: '/eval', adminOnly: true },
  { label: '站点模型', to: '/admin', adminOnly: true },
  { label: 'trace', to: '/traces', adminOnly: true },
]

/** 设计稿的日期格式:YYYY/M/D,不补零 */
function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

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

  function onDelete(id: string) {
    Modal.confirm({
      title: '删除这篇报告?',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => { await api.deleteDocument(id); await refresh() },
    })
  }

  const menuItems: MenuProps['items'] = [
    ...(user && !user.unlimited
      ? [{ key: 'quota', label: `剩余 ${user.remaining} 次提问`, disabled: true }]
      : []),
    { key: 'settings', label: '模型设置', onClick: () => navigate('/settings') },
    { type: 'divider' as const },
    { key: 'logout', label: '登出', onClick: () => { void logout() } },
  ]

  return (
    // 整页撑满视口高度、主体网格吃掉剩余空间:研报少的时候右栏底色和左列右边框
    // 才会一直落到窗口底部,而不是在内容末尾拦腰断开(设计稿的画布高度看不出这点)。
    <div className="flex min-h-screen flex-col bg-page font-sans-sc text-ink">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">

        {/* 顶栏 */}
        <header className="flex items-center justify-between gap-4 border-b border-rule px-[18px] py-3.5 md:px-7 md:py-5 lg:px-10">
          <div className="flex items-baseline gap-7">
            <Link
              to="/"
              className="font-serif-sc text-[18px] font-bold tracking-[0.02em] text-ink md:text-[21px]"
            >
              研报站
            </Link>
            <nav className="hidden gap-[22px] text-[14px] md:flex">
              {NAV_ITEMS.map(item => (
                (!item.adminOnly || isAdmin) && (
                  item.to === '/'
                    ? (
                      <span key={item.to} className="border-b-2 border-brick pb-0.5 font-medium text-ink">
                        {item.label}
                      </span>
                    )
                    : (
                      <Link key={item.to} to={item.to} className="text-ink-soft hover:text-brick">
                        {item.label}
                      </Link>
                    )
                )
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 md:gap-[18px]">
            {isAdmin && (
              <Upload
                accept=".md,.markdown,.txt"
                showUploadList={false}
                beforeUpload={file => { void handleUpload(file); return false }}
              >
                <button
                  type="button"
                  disabled={uploading}
                  className="tap-44 flex items-center gap-1.5 rounded-[4px] border border-navy-edge bg-white px-3 py-[7px] text-[12px] text-navy transition-[border-color,background] duration-150 hover:border-navy hover:bg-navy-wash md:gap-2 md:px-[15px] md:py-2 md:text-[13px]"
                >
                  <UploadOutlined className="text-[13px] md:text-[14px]" aria-hidden />
                  <span className="md:hidden">{uploading ? '上传中' : '上传'}</span>
                  <span className="hidden md:inline">{uploading ? '上传中…' : '上传研报'}</span>
                </button>
              </Upload>
            )}
            <span className="hidden h-[22px] w-px bg-rule md:block" aria-hidden />
            {user ? (
              <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
                <button type="button" className="tap-44 flex items-center gap-[9px]" aria-label="账号菜单">
                  {user.avatarUrl
                    ? <Avatar size={26} src={user.avatarUrl} />
                    : (
                      <span className="flex size-[26px] items-center justify-center rounded-full bg-navy text-[12px] font-medium text-page">
                        {user.username.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  <span className="hidden text-[13px] text-ink-soft md:inline">{user.username}</span>
                  <DownOutlined className="hidden text-[14px] text-ink-faint md:inline" aria-hidden />
                </button>
              </Dropdown>
            ) : (
              <button type="button" onClick={login} className="tap-44 text-[13px] text-navy hover:text-brick">
                GitHub 登录
              </button>
            )}
          </div>
        </header>

        {/* 栏目导航:移动端独立成行、横向可滑 */}
        <nav className="hide-scrollbar flex gap-5 overflow-x-auto border-b border-rule px-[18px] text-[14px] md:hidden">
          {NAV_ITEMS.map(item => (
            (!item.adminOnly || isAdmin) && (
              item.to === '/'
                ? (
                  <span
                    key={item.to}
                    className="whitespace-nowrap border-b-2 border-brick pb-2.5 pt-3 font-medium text-ink"
                  >
                    {item.label}
                  </span>
                )
                : (
                  <Link key={item.to} to={item.to} className="whitespace-nowrap py-3 text-ink-mute">
                    {item.label}
                  </Link>
                )
            )
          ))}
        </nav>

        {/* 设计稿这里是「列表 + 右栏」两列。右栏原本装「本周财报日历」和「按板块浏览」,
            两块都已下掉(前者无数据源、后者建在标题猜测上),右栏空了,竖分隔线和整片
            底色就没有存在意义 —— 暂时收成单列。列表宽度仍按设计稿左列的净宽给上限,
            免得标题行在宽屏上拉得过长。右栏内容一旦回来,把这层换回 grid 即可。 */}
        <div className="mx-auto w-full max-w-[1068px]">

          <main className="px-[18px] md:px-7 md:pb-14 md:pt-9 lg:px-10">
            <div className="flex items-baseline justify-between border-b border-ink pb-2 pt-[18px] md:pb-2.5 md:pt-0">
              <h1 className="m-0 font-serif-sc text-[16px] font-semibold text-ink md:text-[17px]">最新研报</h1>
              <span className="text-[12px] text-ink-faint md:text-[13px] md:text-ink-mute">
                共 {docs.length} 篇
              </span>
            </div>

            {error && <p className="pt-4 text-[13px] text-danger">{error}</p>}

            <div className="flex flex-col md:mt-6">
              {loading && Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-[9px] border-t border-row-rule py-4 md:py-5 md:first:border-t-0"
                  aria-hidden
                >
                  <div className="h-[19px] w-4/5 animate-skeleton rounded-sm bg-[#EDEAE4] motion-reduce:animate-none" />
                  <div className="h-[13px] w-[38%] animate-skeleton rounded-sm bg-[#EDEAE4] motion-reduce:animate-none" />
                </div>
              ))}

              {!loading && docs.map(doc => (
                <article
                  key={doc.id}
                  className="group relative flex flex-col gap-[9px] border-t border-row-rule py-4 transition-colors md:grid md:grid-cols-[76px_minmax(0,1fr)_auto] md:items-baseline md:gap-6 md:py-5 md:first:border-t-0 md:hover:bg-aside lg:grid-cols-[92px_minmax(0,1fr)_auto]"
                >
                  <span className="hidden font-numeral text-[14px] text-ink-faint md:block">
                    {formatDate(doc.created_at)}
                  </span>

                  <div className="flex min-w-0 flex-col gap-[9px] md:gap-2">
                    <h2 className="m-0 font-serif-sc text-[17px] font-semibold leading-[1.5] text-ink [text-wrap:pretty] md:text-[19px] md:leading-[1.45]">
                      {/* 整行可点,但只有标题是真链接:伪元素铺满整行做点击区,
                          既保留「新标签页打开 / 键盘可达」,又不用给 article 挂 onClick。
                          行内其余可点元素(删除)必须 z-[1] 浮在它上面。 */}
                      <Link
                        to={`/reports/${doc.id}`}
                        className="text-inherit after:absolute after:inset-0 after:content-['']"
                      >
                        {doc.filename}
                      </Link>
                    </h2>
                    <div className="flex items-center gap-2 text-[11px] text-ink-mute md:gap-2.5 md:text-[12px]">
                      <span className="hidden md:inline">{doc.chunk_count} 段</span>
                      <span className="ml-auto whitespace-nowrap font-numeral text-ink-faint md:hidden">
                        {formatDate(doc.created_at)} · {doc.chunk_count} 段
                      </span>
                      {/* 触屏没有 hover:移动端把删除放进标签行常显,桌面端在第三列悬停才出现 */}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => onDelete(doc.id)}
                          className="relative z-[1] text-[11px] text-danger md:hidden"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="hidden md:flex md:items-baseline md:gap-3">
                    <span className="text-[13px] text-navy">阅读 ›</span>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => onDelete(doc.id)}
                        className="relative z-[1] text-[12px] text-danger opacity-0 group-hover:opacity-100"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </article>
              ))}

              {/* 空态:保留栏目头与分隔线,正文区只给一行说明(设计稿的空态规范) */}
              {!loading && docs.length === 0 && (
                <p className="py-6 text-[13px] text-ink-faint">还没有研报</p>
              )}
            </div>
          </main>

        </div>
      </div>
    </div>
  )
}
