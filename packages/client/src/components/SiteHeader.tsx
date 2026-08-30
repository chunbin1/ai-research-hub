import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeftOutlined, DownOutlined, UploadOutlined } from '@ant-design/icons'
import { Avatar, Dropdown, Upload } from 'antd'
import type { MenuProps } from 'antd'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'

/**
 * 全站顶栏 —— 设计稿里首页与信号追踪共用同一条(见 design_handoff_homepage,
 * 「组件 1.1 顶栏」与「信号追踪 · 顶栏同首页,当前项为信号」)。
 *
 * 移动端有两种形态:
 * - 默认(首页):logo + 上传/头像,栏目导航独立成一行横向可滑;
 * - 传了 mobile 时(信号追踪):返回箭头 + 页面标题 + 头像,不出栏目行 ——
 *   移动稿把层级交给返回箭头,主导航不重复占一行。
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

interface Props {
  /** 当前栏目的 to,命中项以 2px 红色下边框标出 */
  active: string
  /** 上传成功后通知调用方刷新自己的数据 */
  onUploaded?: () => void
  onUploadError?: (message: string) => void
  /** 正在上传(由调用方持有,按钮据此置灰) */
  uploading?: boolean
  onUploadingChange?: (uploading: boolean) => void
  /** 提供时移动端换成「返回 + 页面标题」形态 */
  mobile?: { backTo: string; title: string }
}

export function SiteHeader({
  active, onUploaded, onUploadError, uploading = false, onUploadingChange, mobile,
}: Props) {
  const navigate = useNavigate()
  const { user, login, logout } = useAuth()
  const isAdmin = user?.isAdmin === true

  async function handleUpload(file: File) {
    onUploadingChange?.(true)
    try {
      await api.uploadDocument(file)
      onUploaded?.()
    } catch (err) {
      onUploadError?.(err instanceof Error ? err.message : '上传失败')
    } finally {
      onUploadingChange?.(false)
    }
  }

  const menuItems: MenuProps['items'] = [
    ...(user && !user.unlimited
      ? [{ key: 'quota', label: `剩余 ${user.remaining} 次提问`, disabled: true }]
      : []),
    { key: 'settings', label: '模型设置', onClick: () => navigate('/settings') },
    { type: 'divider' as const },
    { key: 'logout', label: '登出', onClick: () => { void logout() } },
  ]

  const navLinks = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin)

  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b border-rule px-[18px] py-3.5 md:px-7 md:py-5 lg:px-10">
        {mobile && (
          <div className="flex min-w-0 items-center gap-2.5 md:hidden">
            <Link to={mobile.backTo} aria-label="返回" className="tap-44 text-[18px] leading-none text-ink">
              <ArrowLeftOutlined aria-hidden />
            </Link>
            <span className="truncate font-serif-sc text-[17px] font-semibold text-ink">{mobile.title}</span>
          </div>
        )}

        <div className={`items-baseline gap-7 ${mobile ? 'hidden md:flex' : 'flex'}`}>
          <Link
            to="/"
            className="font-serif-sc text-[18px] font-bold tracking-[0.02em] text-ink md:text-[21px]"
          >
            研报站
          </Link>
          <nav className="hidden gap-[22px] text-[14px] md:flex">
            {navLinks.map(item => (
              item.to === active
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
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3 md:gap-[18px]">
          {isAdmin && (
            // 移动端的信号追踪顶栏只留头像,上传入口在这一档不出现
            <span className={mobile ? 'hidden md:block' : ''}>
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
            </span>
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
      {!mobile && (
        <nav className="hide-scrollbar flex gap-5 overflow-x-auto border-b border-rule px-[18px] text-[14px] md:hidden">
          {navLinks.map(item => (
            item.to === active
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
          ))}
        </nav>
      )}
    </>
  )
}
