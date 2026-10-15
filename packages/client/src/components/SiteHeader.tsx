import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { DownOutlined, GithubOutlined, GoogleOutlined, UploadOutlined } from '@ant-design/icons'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useAuth, type AuthUser } from '../hooks/useAuth'

const UploadReportModal = lazy(() => import('./UploadReportModal').then(m => ({ default: m.UploadReportModal })))

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

/**
 * Google 头像在带上本站 Referer 时会 429，图片加载失败，圆圈就是空的。
 * no-referrer 让浏览器不去带这个头，lh3.googleusercontent.com 才会返回图片。
 */
/** Google 用户名是完整邮箱。顶栏只显示 @ 前面，避免把邮箱摊在页面上。 */
function displayName(username: string): string {
  const at = username.indexOf('@')
  return at > 0 ? username.slice(0, at) : username
}

function UserAvatar({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    return (
      <span className="flex size-[26px] items-center justify-center rounded-full bg-navy text-[12px] font-medium text-page">
        {displayName(name).slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      className="size-[26px] rounded-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

/**
 * 账号菜单不用 antd Dropdown:那会把 rc-menu / rc-trigger 打进首页首屏。
 * 点击展开,点外面或 Esc 关掉。
 */
function AccountMenu({ user, onSettings, onLogout }: {
  user: AuthUser
  onSettings: () => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="tap-44 flex items-center gap-[9px]"
        aria-label="账号菜单"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(v => !v)}
      >
        <UserAvatar url={user.avatarUrl} name={user.username} />
        <span className="hidden text-[13px] text-ink-soft md:inline">{displayName(user.username)}</span>
        <DownOutlined className="hidden text-[14px] text-ink-faint md:inline" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[168px] rounded-[6px] border border-edge bg-white py-1 text-[13px] text-ink shadow-[0_6px_16px_rgba(0,0,0,0.08)]"
        >
          {user && !user.unlimited && (
            <div role="menuitem" aria-disabled="true" className="px-3 py-2 text-ink-mute">
              剩余 {user.remaining} 次提问
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            className="block w-full cursor-pointer px-3 py-2 text-left hover:bg-aside"
            onClick={() => { setOpen(false); onSettings() }}
          >
            模型设置
          </button>
          <div className="my-1 h-px bg-rule" />
          <button
            type="button"
            role="menuitem"
            className="block w-full cursor-pointer px-3 py-2 text-left hover:bg-aside"
            onClick={() => { setOpen(false); onLogout() }}
          >
            登出
          </button>
        </div>
      )}
    </div>
  )
}

/** 当前栏目的 to;不属于任何栏目(如 /settings)时为 null */
function activeTab(pathname: string): string | null {
  if (pathname === '/' || pathname.startsWith('/reports/')) return '/'
  return NAV_ITEMS.find(item => item.to !== '/' && (pathname === item.to || pathname.startsWith(`${item.to}/`)))?.to ?? null
}

export function SiteHeader() {
  const navigate = useNavigate()
  const active = activeTab(useLocation().pathname)
  const { user, loading: authLoading, providers, providersLoading, login, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const loginError = searchParams.get('login_error')
  const loginErrorText = loginError === 'email_unverified'
    ? '这个 Google 账号的邮箱还没验证，不能登录'
    : loginError
      ? '登录没有完成，请再试一次'
      : null
  const isAdmin = user?.isAdmin === true

  /** 「上传研报」弹窗开关:点按钮打开,在弹窗里拖拽或点选文件再提交。
   *  第一次打开才挂载(antd 不进首屏包);关掉之后留着挂载,关闭动画才跑得完。 */
  const [uploadMounted, setUploadMounted] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

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
                onClick={() => { setUploadMounted(true); setUploadOpen(true) }}
                className="flex size-11 items-center justify-center text-navy transition-[border-color,background] duration-150 md:size-auto md:gap-2 md:rounded-[4px] md:border md:border-navy-edge md:bg-white md:px-[15px] md:py-2 md:text-[13px] md:hover:border-navy md:hover:bg-navy-wash"
              >
                <UploadOutlined className="text-[20px] md:text-[14px]" aria-hidden />
                <span className="hidden md:inline">上传研报</span>
              </button>
            </span>
          )}
          <span className="hidden h-[22px] w-px bg-rule md:block" aria-hidden />
          {user ? (
            <AccountMenu
              user={user}
              onSettings={() => navigate('/settings')}
              onLogout={() => { void logout() }}
            />
          ) : authLoading || providersLoading ? (
            // 登录态未知:先留白。抢先画登录按钮的话,已登录的人每次刷新都会
            // 看见它闪一下再换成头像——宽度不同,右侧这一簇跟着横向跳。
            null
          ) : (
            <span className="flex items-center gap-1">
              {providers.github && (
                <button type="button" aria-label="GitHub 登录" title="GitHub 登录" onClick={() => login('github')} className="tap-44 flex size-11 cursor-pointer items-center justify-center text-[18px] text-navy md:size-[26px] md:text-[16px]">
                  <GithubOutlined />
                </button>
              )}
              {providers.google && (
                <button type="button" aria-label="Google 登录" title="Google 登录" onClick={() => login('google')} className="tap-44 flex size-11 cursor-pointer items-center justify-center text-[18px] text-navy md:size-[26px] md:text-[16px]">
                  <GoogleOutlined />
                </button>
              )}
            </span>
          )}
        </div>
      </header>

      {loginErrorText && (
        <p className="flex items-center justify-between gap-3 border-b border-rule bg-aside px-[18px] py-2 text-[13px] text-ink-soft md:px-7">
          <span>{loginErrorText}</span>
          <button
            type="button"
            className="cursor-pointer text-navy"
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.delete('login_error')
              setSearchParams(next, { replace: true })
            }}
          >
            知道了
          </button>
        </p>
      )}

      {isAdmin && uploadMounted && (
        <Suspense fallback={null}>
          <UploadReportModal
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            onUploaded={() => { setUploadOpen(false); window.dispatchEvent(new Event(REPORT_UPLOADED_EVENT)) }}
          />
        </Suspense>
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
