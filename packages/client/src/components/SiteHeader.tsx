import { Link, useLocation, useNavigate } from 'react-router-dom'
import { DownOutlined, UploadOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { Avatar, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { UploadReportModal } from './UploadReportModal'
import { useAuth } from '../hooks/useAuth'

/**
 * 全站顶栏 —— 只由 SiteLayout 挂一份,所有页面共用(见 SiteLayout 的说明)。
 *
 * 当前栏目从路由推出来,不靠页面传:详情页归到所属栏目(/reports/x → 研报)。
 * 移动端:logo + 上传/头像,栏目导航独立成一行横向可滑。每个页面都是这一个形态 ——
 * 以前信号页移动端换成「返回 + 标题」、不出栏目行,切过去顶栏整个变样。
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

/**
 * 上传成功后在 window 上广播。顶栏是布局级的,不知道当前是哪个页面、该刷新什么,
 * 由关心的页面(首页列表)自己监听。与 useAuth 的 auth:refresh 同一个套路。
 */
export const REPORT_UPLOADED_EVENT = 'report:uploaded'

/** 当前栏目的 to;不属于任何栏目(如 /settings)时为 null */
function activeTab(pathname: string): string | null {
  if (pathname === '/' || pathname.startsWith('/reports/')) return '/'
  return NAV_ITEMS.find(item => item.to !== '/' && (pathname === item.to || pathname.startsWith(`${item.to}/`)))?.to ?? null
}

export function SiteHeader() {
  const navigate = useNavigate()
  const active = activeTab(useLocation().pathname)
  const { user, loading: authLoading, login, logout } = useAuth()
  const isAdmin = user?.isAdmin === true

  /** 「上传研报」弹窗开关:点按钮打开,在弹窗里拖拽或点选文件再提交 */
  const [uploadOpen, setUploadOpen] = useState(false)

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
      <header className="flex items-center justify-between gap-4 border-b border-rule py-2.5 pl-[18px] pr-3 md:px-7 md:py-5 lg:px-10">
        <div className="flex items-baseline gap-7">
          <Link
            to="/"
            className="font-serif-sc text-[18px] font-bold tracking-[0.02em] text-ink md:text-[21px]"
          >
            研报站
          </Link>
          <nav className="hidden gap-[22px] text-[14px] md:flex">
            {/* 当前项也是链接:在详情页(阅读页、评估明细)上点它就回到栏目首页 */}
            {navLinks.map(item => (
              <Link
                key={item.to}
                to={item.to}
                aria-current={item.to === active ? 'page' : undefined}
                className={item.to === active
                  ? 'border-b-2 border-brick pb-0.5 font-medium text-ink'
                  : 'text-ink-soft hover:text-brick'}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* 右侧操作区的高度锁死在「上传按钮」那一档(移动 44 / 桌面 37.5,量出来的
            边框盒高度)。这一格的内容要等 /api/auth/me 回来才定型——不锁的话管理员
            每次进站都是顶栏先 54.5/73px、拿到登录态后弹到 62.5/77.5px,整页跟着下移。 */}
        <div className="flex min-h-11 items-center gap-1 md:min-h-[37.5px] md:gap-[18px]">
          {isAdmin && (
            <span>
              {/* 移动端只留图标(44×44 热区),桌面是带字的描边按钮 */}
              <button
                type="button"
                aria-label="上传研报"
                onClick={() => setUploadOpen(true)}
                className="flex size-11 items-center justify-center text-navy transition-[border-color,background] duration-150 md:size-auto md:gap-2 md:rounded-[4px] md:border md:border-navy-edge md:bg-white md:px-[15px] md:py-2 md:text-[13px] md:hover:border-navy md:hover:bg-navy-wash"
              >
                <UploadOutlined className="text-[20px] md:text-[14px]" aria-hidden />
                <span className="hidden md:inline">上传研报</span>
              </button>
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
          ) : authLoading ? (
            // 登录态未知:先留白。抢先画「GitHub 登录」的话,已登录的人每次刷新都会
            // 看见它闪一下再换成头像——宽度不同,右侧这一簇跟着横向跳。
            null
          ) : (
            <button type="button" onClick={login} className="tap-44 text-[13px] text-navy hover:text-brick">
              GitHub 登录
            </button>
          )}
        </div>
      </header>

      {isAdmin && (
        <UploadReportModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => { setUploadOpen(false); window.dispatchEvent(new Event(REPORT_UPLOADED_EVENT)) }}
        />
      )}

      {/* 栏目导航:移动端独立成行、横向可滑 */}
      <nav className="hide-scrollbar flex gap-5 overflow-x-auto border-b border-rule px-[18px] text-[14px] md:hidden">
        {navLinks.map(item => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={item.to === active ? 'page' : undefined}
            className={item.to === active
              ? 'whitespace-nowrap border-b-2 border-brick pb-2.5 pt-3 font-medium text-ink'
              : 'whitespace-nowrap py-3 text-ink-mute'}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  )
}
