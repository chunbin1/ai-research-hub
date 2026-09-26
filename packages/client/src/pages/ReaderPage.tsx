import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Drawer } from 'antd'
import { CloseOutlined, DownOutlined, LeftOutlined, MessageOutlined, RightOutlined } from '@ant-design/icons'
import { api } from '../api'
import { extractToc, outlineOf, visibleOutline } from '../lib/toc'
import { useIsMobile } from '../hooks/useIsMobile'
import ReportMarkdown from '../components/ReportMarkdown'
import ChatPanel from '../components/ChatPanel'
import { BackLink } from '../components/BackLink'
import type { DocumentVersion } from '../types'

/**
 * 阅读页 —— 按「报告详情」「报告详情 移动端」两份设计稿重建。
 *
 * 桌面(≥768):全站顶栏 + [目录 232 | 正文(吸顶工具栏)],问答是浮在右侧的
 *   卡片(距上下 12px、距右 16px,圆角、投影),不占栏宽 —— 打开问答时目录和正文
 *   都不挪位置,卡片直接盖在正文上。
 *   正文吃满内容区(不再给问答留右侧空白,那块平时空着太浪费),表格和正文同宽;
 *   超宽屏上限 1120 居中,免得一行长到读不下去。
 * 移动(<768):返回 + 标题 + 目录按钮的顶栏,底部常驻「问这篇报告」条;
 *   目录、版本、问答都是弹层(antd Drawer:自带遮罩、滚动锁、焦点管理)。
 *
 * 设计稿正文顶部那块结构化摘要(资料截止 / 锚定公司 / 一句话结论)是照其中一篇
 * 手排的,原文格式各异、库里也没有对应字段 —— 暂不做,正文按 markdown 原样排。
 */

const CHAT_OPEN_KEY = 'reader.chatOpen'

/** 版本日期:YYYY-MM-DD(设计稿版本下拉里的格式) */
function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ReaderPage() {
  const { id = '' } = useParams()
  // 所选版本放在 URL 里(?v=2):能分享、刷新不丢。不带就是最新版。
  const [searchParams, setSearchParams] = useSearchParams()
  const vParam = searchParams.get('v')
  const requestedVersion = vParam === null ? undefined : Number(vParam)
  const isMobile = useIsMobile()
  const [markdown, setMarkdown] = useState('')
  const [filename, setFilename] = useState('')
  const [version, setVersion] = useState<number | undefined>(undefined)
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [error, setError] = useState('')
  /** 移动端的弹层:同一时刻最多开一个(都是覆盖式的,叠起来遮罩会点不掉) */
  const [sheet, setSheet] = useState<'toc' | 'ver' | null>(null)
  // 桌面:默认收起(问答是盖在正文上的浮窗,一进来就开着会挡字),
  //       手动打开过就记在 localStorage,下次进来沿用。
  // 手机:恒为收起且不写 localStorage——否则一进阅读页就被问答弹层盖掉大半正文。
  // 跨断点缩放窗口时不重置该值:它在两侧语义一致(问答是否可见),重置会让面板莫名开合。
  const [chatOpen, setChatOpen] = useState(() =>
    isMobile ? false : localStorage.getItem(CHAT_OPEN_KEY) === '1',
  )
  const toolbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setError('')
    api.getDocument(id, requestedVersion)
      .then(({ document: doc, markdown, version, versions }) => {
        setMarkdown(markdown)
        setVersion(version)
        setVersions(versions ?? [])
        // 看旧版本时标题也用那一版的 —— 研报更新后标题可能变了
        const title = versions?.find(v => v.version === version)?.filename ?? doc.filename
        setFilename(title)
        document.title = `${title} — 研报站`
        // 换版本是换了一篇正文,回到顶部
        document.getElementById('report-content')?.scrollTo({ top: 0 })
      })
      .catch(e => setError(String(e.message)))
  }, [id, requestedVersion])

  const toc = useMemo(() => extractToc(markdown), [markdown])
  // 当前版本里有哪些章节锚点 —— 问答里引用的章节在这一版没有的话,来源就不能点
  const slugs = useMemo(() => new Set(toc.map(t => t.slug)), [toc])
  const latest = versions.length ? versions[versions.length - 1] : null
  const viewing = versions.find(v => v.version === version) ?? null
  const isOld = latest !== null && viewing !== null && viewing.version !== latest.version
  // 目录两层(章 + 节),规则见 lib/toc 的 outlineOf
  const tocItems = useMemo(() => outlineOf(toc), [toc])
  /** 有下属小节的章:目录里给它画个展开 / 收起的箭头 */
  const chaptersWithSubs = useMemo(() => new Set(tocItems.filter(t => !t.top).map(t => t.chapter)), [tocItems])
  const [activeSlug, setActiveSlug] = useState('')
  // 目录只展开当前读到的那一章(visibleOutline)
  const shownToc = visibleOutline(tocItems, activeSlug)
  const activeChapter = tocItems.find(t => t.slug === activeSlug)?.chapter ?? ''

  // 目录高亮跟着阅读位置走:取「顶到工具栏下沿以上」的最后一个章节标题。
  // 滚动事件用 rAF 合并,一帧最多量一次。
  useEffect(() => {
    const container = document.getElementById('report-content')
    if (!container || tocItems.length === 0) return
    let frame = 0
    const measure = () => {
      frame = 0
      const line = container.getBoundingClientRect().top + (toolbarRef.current?.offsetHeight ?? 0) + 24
      let current = ''
      for (const t of tocItems) {
        const el = document.getElementById(t.slug)
        if (!el) continue
        if (el.getBoundingClientRect().top <= line) current = t.slug
        else break
      }
      setActiveSlug(current)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure) }
    container.addEventListener('scroll', onScroll, { passive: true })
    measure()
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [tocItems])

  function switchVersion(v: number) {
    setSheet(null)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      // 最新版不写进 URL:这样分享出去的「最新」链接永远指向最新
      if (latest && v === latest.version) next.delete('v')
      else next.set('v', String(v))
      return next
    })
  }

  // 溯源回链:滚动到章节标题并临时高亮。
  // 注:显式滚动 #report-content 容器,而非 el.scrollIntoView()——后者对
  // 嵌套滚动容器 + smooth 存在浏览器兼容问题,常常不生效。
  function jump(slug: string) {
    // 手机上问答 / 目录都是盖住正文的弹层,不收起的话看不到跳过去的地方。
    if (isMobile) {
      setChatOpen(false)
      setSheet(null)
    }
    setActiveSlug(slug)
    const el = document.getElementById(slug)
    const container = document.getElementById('report-content')
    if (!el || !container) return
    // 桌面工具栏吸顶,要让开它的高度;移动端它是 display:none,offsetHeight 为 0
    const offset = (toolbarRef.current?.offsetHeight ?? 0) + 16
    const top = container.scrollTop + (el.getBoundingClientRect().top - container.getBoundingClientRect().top) - offset
    // 用 'auto' 而非 'smooth':部分环境(reduced-motion / 自动化浏览器)会静默忽略
    // smooth 滚动导致完全不跳转;瞬时跳转 + flash 高亮反而更稳、反馈更即时。
    container.scrollTo({ top, behavior: 'auto' })
    el.classList.remove('flash')
    void el.offsetWidth // 强制回流,便于重复点击重新触发动画
    el.classList.add('flash')
    window.setTimeout(() => el.classList.remove('flash'), 1600)
  }

  function setChat(open: boolean) {
    setChatOpen(open)
    if (!isMobile) localStorage.setItem(CHAT_OPEN_KEY, open ? '1' : '0')
    // 移动端问答弹层和其他弹层互斥
    if (isMobile && open) setSheet(null)
  }

  if (error) {
    return (
      <div className="p-10">
        <BackLink to="/" className="mb-4 block text-[14px] text-ink-soft hover:text-navy">全部报告</BackLink>
        <p>{error}</p>
      </div>
    )
  }

  const chatProps = { docId: id, onCite: jump, version, slugs }
  const segments = viewing?.chunk_count

  /**
   * 目录条目:桌面侧栏和移动端抽屉共用,只是字号 / 行距不同。
   * 章全部列出,节只列当前章的;点别的章会跳过去,它的节随之展开。
   * key 用 slug:折叠后下标会变,用下标当 key 会让条目错位复用。
   */
  const tocList = (mobile: boolean) => (
    <nav className="flex flex-col" aria-label="目录">
      {shownToc.map(t => {
        const { top } = t
        const open = t.slug === activeChapter
        return (
          <a
            key={t.slug}
            href={`#${t.slug}`}
            onClick={e => { e.preventDefault(); jump(t.slug) }}
            aria-expanded={top && chaptersWithSubs.has(t.slug) ? open : undefined}
            className={`cursor-pointer leading-[1.55] hover:text-navy ${mobile ? 'text-[14px]' : 'text-[13px]'} ${
              top
                ? `flex items-start justify-between gap-2 font-medium text-ink ${mobile ? 'py-[11px] pl-2.5' : 'py-1.5 pl-2.5'}`
                : `block text-ink-soft ${mobile ? 'py-[9px] pl-[22px]' : 'py-1 pl-[22px]'}`
            } ${t.slug === activeSlug ? 'shadow-[inset_2px_0_0_var(--color-brick)]' : ''}`}
          >
            {t.title}
            {top && chaptersWithSubs.has(t.slug) && (
              <RightOutlined
                aria-hidden
                className={`mt-[0.45em] flex-none text-[9px] text-ink-faint transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
              />
            )}
          </a>
        )
      })}
    </nav>
  )

  return (
    // 外壳由 SiteLayout 锁成视口高(桌面在全站顶栏下面),这里吃掉剩余高度
    <div className="reader-shell flex min-h-0 flex-1 flex-col">

      {/* 移动顶栏:返回 + 标题 + 目录 */}
      <header className="flex h-[52px] flex-none items-center gap-1 border-b border-rule bg-page px-1.5 md:hidden">
        <Link to="/" aria-label="返回全部报告" className="flex size-11 flex-none items-center justify-center text-[18px] text-ink">
          <LeftOutlined aria-hidden />
        </Link>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{filename}</span>
        <button
          type="button"
          aria-label="打开目录"
          aria-expanded={sheet === 'toc'}
          aria-controls="toc-drawer"
          onClick={() => { setSheet('toc'); setChatOpen(false) }}
          className="flex size-11 flex-none items-center justify-center text-ink-soft"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16" /><path d="M8 12h12" /><path d="M8 18h12" />
          </svg>
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* 桌面目录栏 */}
        <aside className="hidden w-[232px] flex-none overflow-y-auto border-r border-rule bg-aside px-5 pb-10 pt-7 md:block">
          <div className="mb-2 border-b border-ink pb-2 text-[12px] tracking-[0.08em] text-ink-mute">目录</div>
          {tocList(false)}
        </aside>

        <main id="report-content" className="min-w-0 flex-1 overflow-y-auto">
          {/* 桌面吸顶工具栏 */}
          <div
            ref={toolbarRef}
            className="sticky top-0 z-[2] hidden items-center justify-between gap-4 border-b border-row-rule bg-page px-12 py-3 md:flex"
          >
            <div className="flex min-w-0 items-center gap-2.5 whitespace-nowrap text-[12px] text-ink-mute">
              <Link
                to="/"
                className="-ml-1 flex flex-none items-center gap-1 rounded py-1 pl-1 pr-2 text-[13px] text-ink-soft hover:bg-[#F0EEE8] hover:text-navy"
              >
                <LeftOutlined aria-hidden className="text-[11px]" />
                全部报告
              </Link>
              <span className="h-3.5 w-px flex-none bg-edge" aria-hidden />
              {viewing && latest && (
                <VersionMenu versions={versions} viewing={viewing} latest={latest} onSwitch={switchVersion} />
              )}
              {segments !== undefined && <span className="font-numeral">{segments} 段</span>}
            </div>
            {/* 常驻:浮窗开着时再点一下收起 */}
            <button
              type="button"
              onClick={() => setChat(!chatOpen)}
              aria-controls="chat-panel"
              aria-expanded={chatOpen}
              className="flex flex-none cursor-pointer items-center gap-2 rounded bg-navy px-4 py-2 text-[13px] font-medium text-page hover:bg-[#14304D]"
            >
              <MessageOutlined aria-hidden />
              问这篇报告
            </button>
          </div>

          {isOld && latest && viewing && (
            <div
              role="status"
              className="flex items-center justify-between gap-2.5 border-b border-edge bg-aside px-5 py-2.5 text-[13px] text-ink-soft md:flex-wrap md:justify-center md:gap-3.5 md:px-12"
            >
              <span>
                <span className="md:hidden">历史版本 v{viewing.version} · {formatDate(viewing.created_at)}</span>
                <span className="hidden md:inline">正在查看历史版本 v{viewing.version}({formatDate(viewing.created_at)})</span>
              </span>
              <button
                type="button"
                onClick={() => switchVersion(latest.version)}
                className="flex-none cursor-pointer py-1.5 font-medium text-navy hover:text-brick"
              >
                <span className="md:hidden">看最新版 ›</span>
                <span className="hidden md:inline">切换到最新版 v{latest.version} ›</span>
              </button>
            </div>
          )}

          {/* 桌面:正文吃满内容区,上限 1120(+ 两侧各 48 内边距)居中 */}
          <div className="mx-auto max-w-[1216px] px-5 pb-10 pt-6 md:px-12 md:pb-24 md:pt-11">
            {/* 移动端版本行(桌面的在工具栏里) */}
            {viewing && latest && (
              <div className="mb-3 flex flex-wrap items-center gap-2.5 md:hidden">
                <VersionChip
                  viewing={viewing}
                  latest={latest}
                  multiple={versions.length > 1}
                  onClick={() => { setSheet('ver'); setChatOpen(false) }}
                  size="lg"
                />
                {segments !== undefined && <span className="font-numeral text-[13px] text-ink-faint">{segments} 段</span>}
              </div>
            )}
            <article className="report-body">
              <ReportMarkdown markdown={markdown} />
            </article>
          </div>
        </main>

        {/*
          桌面问答浮窗。收起时 display:none 而不是卸载:ChatPanel 带着对话状态,
          收起再展开不该丢。ChatPanel 本身(带 SSE / fetch 副作用)只能有一个实例,
          按 isMobile 二选一挂载。
        */}
        <aside
          id={isMobile ? undefined : 'chat-panel'}
          aria-label="问这篇报告"
          inert={!chatOpen}
          className={`absolute inset-y-3 right-4 z-[6] hidden w-[368px] max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-lg border border-edge bg-white shadow-[0_16px_48px_-12px_rgba(20,22,26,0.28)] ${
            chatOpen ? 'md:flex' : ''
          }`}
        >
          {!isMobile && <ChatPanel {...chatProps} open={chatOpen} onClose={() => setChat(false)} />}
        </aside>
      </div>

      {/* 移动端底部提问条 */}
      <div className="flex-none border-t border-rule bg-white px-3.5 pb-[max(1.375rem,env(safe-area-inset-bottom))] pt-2.5 md:hidden">
        <button
          type="button"
          onClick={() => setChat(true)}
          aria-controls="chat-panel"
          aria-expanded={chatOpen}
          aria-label="打开问答"
          className="flex h-[46px] w-full items-center gap-2.5 rounded-full border border-edge bg-aside pl-3.5 pr-1.5 text-left"
        >
          <MessageOutlined aria-hidden className="text-[17px] text-navy" />
          <span className="flex-1 text-[14px] text-ink-mute">问这篇报告…</span>
          <span className="flex h-[34px] flex-none items-center rounded-full bg-navy px-4 text-[13px] font-medium text-page">提问</span>
        </button>
      </div>

      {isMobile && (
        <>
          <Drawer
            id="toc-drawer"
            placement="right"
            open={sheet === 'toc'}
            onClose={() => setSheet(null)}
            size={300}
            closable={false}
            rootClassName="reader-toc-drawer"
            styles={{ body: { padding: 0 }, section: { background: 'var(--color-aside)' } }}
          >
            <div className="flex h-full flex-col font-sans-sc text-ink">
              <div className="flex h-[52px] flex-none items-center justify-between border-b border-ink pl-5 pr-1.5">
                <span className="font-serif-sc text-[16px] font-semibold">目录</span>
                <button
                  type="button"
                  aria-label="关闭目录"
                  onClick={() => setSheet(null)}
                  className="flex size-11 items-center justify-center text-[16px] text-ink-mute"
                >
                  <CloseOutlined aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-3">{tocList(true)}</div>
            </div>
          </Drawer>

          <Drawer
            placement="bottom"
            open={sheet === 'ver'}
            onClose={() => setSheet(null)}
            size="auto"
            closable={false}
            rootClassName="reader-ver-drawer"
            styles={{ body: { padding: 0 }, section: { borderRadius: '14px 14px 0 0' } }}
          >
            {viewing && latest && (
              <div className="flex flex-col pb-6 pt-2 font-sans-sc text-ink">
                <div className="flex justify-center pb-2" aria-hidden>
                  <div className="h-1 w-9 rounded-full bg-edge" />
                </div>
                <div className="flex items-baseline justify-between border-b border-row-rule px-5 pb-3 pt-1.5">
                  <span className="font-serif-sc text-[16px] font-semibold">切换版本</span>
                  <span className="text-[12px] text-ink-faint">共 {versions.length} 个</span>
                </div>
                <VersionOptions versions={versions} viewing={viewing} latest={latest} onSwitch={switchVersion} mobile />
              </div>
            )}
          </Drawer>

          <Drawer
            id="chat-panel"
            placement="bottom"
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            size="78dvh"
            closable={false}
            rootClassName="reader-chat-drawer"
            styles={{ body: { padding: 0, overflow: 'hidden' }, section: { borderRadius: '14px 14px 0 0' } }}
          >
            <ChatPanel {...chatProps} variant="sheet" open={chatOpen} onClose={() => setChatOpen(false)} />
          </Drawer>
        </>
      )}
    </div>
  )
}

/** 「v2 2026-09-26 最新 ⌄」。只有一个版本时是静态标签,没有下拉 */
function VersionChip({ viewing, latest, multiple, onClick, size, expanded }: {
  viewing: DocumentVersion
  latest: DocumentVersion
  multiple: boolean
  onClick: () => void
  size: 'sm' | 'lg'
  expanded?: boolean
}) {
  const body = (
    <>
      <span className="font-medium">v{viewing.version}</span>
      <span className="font-numeral text-ink-mute">{formatDate(viewing.created_at)}</span>
      {viewing.version === latest.version && multiple && (
        <span className="rounded-[3px] bg-[#E4EAF0] px-1.5 py-px text-[11px] text-navy">最新</span>
      )}
    </>
  )
  const box = `flex items-center gap-1.5 rounded border border-edge bg-white text-[13px] text-ink ${
    size === 'lg' ? 'h-8 pl-2.5 pr-2' : 'py-[5px] pl-2.5 pr-2'
  }`
  if (!multiple) return <span className={box}>{body}</span>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="选择版本"
      aria-haspopup="true"
      aria-expanded={expanded}
      className={`${box} cursor-pointer hover:border-navy`}
    >
      {body}
      <DownOutlined aria-hidden className="text-[11px] text-ink-faint" />
    </button>
  )
}

/** 版本列表:桌面下拉与移动端底部弹层共用 */
function VersionOptions({ versions, viewing, latest, onSwitch, mobile }: {
  versions: DocumentVersion[]
  viewing: DocumentVersion
  latest: DocumentVersion
  onSwitch: (v: number) => void
  mobile?: boolean
}) {
  // 从新到旧:最常切的是最近几版
  return (
    <div role="menu" className="flex flex-col">
      {[...versions].reverse().map(v => {
        const current = v.version === viewing.version
        return (
          <button
            key={v.version}
            type="button"
            role="menuitemradio"
            aria-checked={current}
            onClick={() => onSwitch(v.version)}
            className={`grid cursor-pointer items-center text-left ${
              mobile
                ? 'grid-cols-[minmax(0,1fr)_20px] gap-3 border-b border-row-rule px-5 py-3.5'
                : 'grid-cols-[16px_minmax(0,1fr)] gap-2.5 rounded p-2.5 hover:bg-aside'
            } ${current ? 'bg-navy-wash' : ''}`}
          >
            {!mobile && <span className="self-start pt-0.5 text-[13px] text-navy">{current ? '✓' : ''}</span>}
            <span className="flex min-w-0 flex-col gap-[3px]">
              <span className={`flex items-center gap-2 ${mobile ? 'text-[15px]' : 'text-[13px]'}`}>
                <span className="font-medium text-ink">v{v.version}</span>
                <span className="font-numeral text-ink-mute">{formatDate(v.created_at)}</span>
                {v.version === latest.version && (
                  <span className="rounded-[3px] bg-[#E4EAF0] px-1.5 py-px text-[11px] text-navy">最新</span>
                )}
              </span>
              {v.note && (
                <span className={`leading-[1.5] text-ink-mute ${mobile ? 'text-[13px]' : 'text-[12px]'}`}>{v.note}</span>
              )}
            </span>
            {mobile && <span className="text-[16px] text-navy">{current ? '✓' : ''}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** 桌面工具栏里的版本下拉 */
function VersionMenu({ versions, viewing, latest, onSwitch }: {
  versions: DocumentVersion[]
  viewing: DocumentVersion
  latest: DocumentVersion
  onSwitch: (v: number) => void
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative flex-none">
      <VersionChip
        viewing={viewing}
        latest={latest}
        multiple={versions.length > 1}
        onClick={() => setOpen(o => !o)}
        size="sm"
        expanded={open}
      />
      {open && (
        <>
          {/* 点外面关闭 */}
          <div className="fixed inset-0 z-[8]" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-[calc(100%+6px)] z-[9] flex w-[320px] flex-col whitespace-normal rounded-md border border-edge bg-white p-1.5 shadow-[0_12px_32px_-8px_rgba(20,22,26,0.22)]">
            <span className="px-2.5 pb-1.5 pt-2 text-[12px] text-ink-faint">版本记录 · 共 {versions.length} 个</span>
            <VersionOptions
              versions={versions}
              viewing={viewing}
              latest={latest}
              onSwitch={v => { setOpen(false); onSwitch(v) }}
            />
          </div>
        </>
      )}
    </div>
  )
}
