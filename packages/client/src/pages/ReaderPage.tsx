import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Drawer, Select } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import { api } from '../api'
import { extractToc } from '../lib/toc'
import { useIsMobile } from '../hooks/useIsMobile'
import ReportMarkdown from '../components/ReportMarkdown'
import ChatPanel from '../components/ChatPanel'
import { BackLink } from '../components/BackLink'
import type { DocumentVersion } from '../types'

const CHAT_OPEN_KEY = 'reader.chatOpen'

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
  const [tocOpen, setTocOpen] = useState(false)
  // 桌面:沿用 localStorage 记忆,默认展开。
  // 手机:恒为收起且不写 localStorage——否则一进阅读页就被 70dvh 面板盖掉大半正文。
  // 跨断点缩放窗口时不重置该值:它在两侧语义一致(问答是否可见),重置会让面板莫名开合。
  const [chatOpen, setChatOpen] = useState(() =>
    isMobile ? false : localStorage.getItem(CHAT_OPEN_KEY) !== '0',
  )

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

  const toc = extractToc(markdown)
  // 当前版本里有哪些章节锚点 —— 问答里引用的章节在这一版没有的话,来源就不能点
  const slugs = useMemo(() => new Set(extractToc(markdown).map(t => t.slug)), [markdown])
  const latest = versions.length ? versions[versions.length - 1] : null
  const viewing = versions.find(v => v.version === version) ?? null
  const isOld = latest !== null && viewing !== null && viewing.version !== latest.version

  function switchVersion(v: number) {
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
    // 手机上问答面板占 70dvh,不收起的话答案会盖着要跳过去的正文。
    // 面板是 fixed 定位、不占布局流,所以不影响下面的 scrollTop 几何,无需等动画帧。
    if (isMobile) {
      setChatOpen(false)
      setTocOpen(false)
    }
    const el = document.getElementById(slug)
    const container = document.getElementById('report-content')
    if (!el || !container) return
    const top = container.scrollTop + (el.getBoundingClientRect().top - container.getBoundingClientRect().top) - 16
    // 用 'auto' 而非 'smooth':部分环境(reduced-motion / 自动化浏览器)会静默忽略
    // smooth 滚动导致完全不跳转;瞬时跳转 + flash 高亮反而更稳、反馈更即时。
    container.scrollTo({ top, behavior: 'auto' })
    el.classList.remove('flash')
    void el.offsetWidth // 强制回流,便于重复点击重新触发动画
    el.classList.add('flash')
    window.setTimeout(() => el.classList.remove('flash'), 1600)
  }

  function toggleChat() {
    setChatOpen(open => {
      const next = !open
      if (!isMobile) localStorage.setItem(CHAT_OPEN_KEY, next ? '1' : '0')
      return next
    })
    // 目录抽屉与问答面板不能同时打开(两者都是覆盖式的移动端浮层)——
    // 打开问答面板的同时收起目录抽屉;面板已收起时这一步是空操作,无副作用。
    if (isMobile) setTocOpen(false)
  }

  if (error) {
    return (
      <div className="p-10">
        <BackLink to="/" className="mb-4 block text-[14px] text-[#555] hover:text-black">全部报告</BackLink>
        <p>{error}</p>
      </div>
    )
  }

  // 目录内容:桌面端 grid 列与移动端 Drawer 共用同一份 JSX,不写两遍。
  // 内边距(px-3 py-5)原来挂在外层容器上;这里内建到内容里,
  // 这样 Drawer(body padding 设为 0)和桌面 <aside> 视觉像素一致。
  const tocContent = (
    <div className="px-3 py-5">
      <BackLink to="/" className="mb-4 block text-[14px] text-[#555] hover:text-black">全部报告</BackLink>
      <nav>
        {toc.map((t, i) => (
          <a
            key={i}
            className="flex min-h-11 cursor-pointer items-center rounded-md px-2 py-[5px] text-[13px] leading-[1.4] text-[#444] hover:bg-[#eee] hover:text-black md:block md:min-h-0"
            style={{ paddingLeft: 8 + (t.level - 1) * 12 }}
            onClick={() => jump(t.slug)}
          >
            {t.title}
          </a>
        ))}
      </nav>
    </div>
  )

  return (
    <div
      className={`reader-shell relative flex h-dvh flex-col md:grid md:h-screen md:transition-[grid-template-columns] md:duration-[240ms] md:ease-[ease] motion-reduce:md:transition-none ${
        chatOpen
          ? 'md:grid-cols-[240px_minmax(0,1fr)_360px]'
          : 'md:grid-cols-[240px_minmax(0,1fr)_0px]'
      }`}
    >
      {/* 移动顶栏:桌面不渲染,桌面的「← 全部报告」在目录栏顶部 */}
      <header className="flex h-12 flex-none items-center gap-3 border-b border-[#eee] bg-surface px-3 md:hidden">
        <button
          type="button"
          aria-label="打开目录"
          aria-expanded={tocOpen}
          aria-controls="toc-drawer"
          onClick={() => {
            setTocOpen(true)
            // 目录抽屉与问答面板都是覆盖式浮层(antd Drawer),同时打开时上层的遮罩会
            // 挡住下层——点不到下层内容,遮罩自身也点不掉。打开抽屉的同时收起问答面板
            // (仅移动端;不写 localStorage,与 jump() 一致)。
            if (isMobile) setChatOpen(false)
          }}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-lg text-[#555]"
        >
          <MenuOutlined />
        </button>
        <span className="truncate text-sm font-medium">{filename}</span>
      </header>

      {/*
        桌面端目录列:grid 第一列。用 hidden/md:block 做纯 CSS 可见性切换(不用
        isMobile 条件渲染布局——useIsMobile 的约定是只管行为,布局交给 md: 前缀),
        与移动端 Drawer 的挂载/卸载互不影响。
      */}
      <aside
        id={isMobile ? undefined : 'toc-drawer'}
        className="hidden overflow-y-auto border-r border-[#eee] bg-surface md:block md:w-[240px]"
      >
        {tocContent}
      </aside>

      {/* 移动端目录抽屉:antd Drawer 自带遮罩、滚动锁、开合动画与焦点管理 */}
      {isMobile && (
        <Drawer
          id="toc-drawer"
          placement="left"
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          width={240}
          closable={false}
          styles={{ body: { padding: 0 } }}
          rootClassName="reader-toc-drawer"
        >
          {tocContent}
        </Drawer>
      )}

      <main id="report-content" className="report-body flex-1 overflow-y-auto px-5 py-6 md:px-14 md:py-10">
        {versions.length > 1 && (
          <VersionBar
            versions={versions}
            current={version}
            isOld={isOld}
            latest={latest}
            onSwitch={switchVersion}
          />
        )}
        <ReportMarkdown markdown={markdown} />
      </main>

      {/*
        toggle 按钮:移动端是流内的底部整条,桌面端是贴在问答栏左沿的 18×60 竖条。
        始终在 <aside> 外面,这样面板 inert 时按钮依然可点。
        移动端 z-index 用 z-[1001]——antd Drawer 的 mask/内容层 z-index 固定是
        1000(token zIndexPopupBase),必须压过它,否则抽屉打开时遮罩会盖住整条
        底部条,点不到、也看不见(对应 Step 5 第 4 条「遮罩在抽屉之下,底部条在最上」)。
      */}
      <button
        type="button"
        onClick={toggleChat}
        aria-expanded={chatOpen}
        aria-controls="chat-panel"
        title={chatOpen ? '收起问答栏' : '展开问答栏'}
        className={`relative z-[1001] flex h-[calc(2.75rem+env(safe-area-inset-bottom))] w-full flex-none cursor-pointer items-center justify-center border-t border-[#eee] bg-white text-sm text-[#555] pb-[env(safe-area-inset-bottom)] md:absolute md:top-1/2 md:z-5 md:h-15 md:w-[18px] md:-translate-y-1/2 md:rounded-l-lg md:border md:border-r-0 md:border-[#eee] md:bg-white md:p-0 md:text-[13px] md:leading-[1] md:text-[#999] md:transition-[right,color,background] md:duration-[240ms] md:ease-[ease] md:hover:bg-[#f3f3f0] md:hover:text-black motion-reduce:md:transition-none ${
          chatOpen ? 'md:right-[360px]' : 'md:right-0'
        }`}
      >
        <span className="md:hidden">{chatOpen ? '收起问答 ▽' : '问这篇报告 △'}</span>
        <span className="hidden md:inline">{chatOpen ? '›' : '‹'}</span>
      </button>

      {/*
        问答面板容器:桌面端回到 grid 第三列,收起时列宽压到 0、面板被
        overflow-hidden 裁掉,inert 保证收起时不进 tab 序 / 无障碍树。用
        hidden/md:flex 做纯 CSS 可见性切换,不用 isMobile 条件渲染布局——
        但 <ChatPanel> 本身(带 SSE / fetch 副作用)只能有一个实例,
        真正挂载与否仍按 isMobile 二选一,避免移动端同时挂载出两份问答会话。
      */}
      <aside
        id={isMobile ? undefined : 'chat-panel'}
        inert={!chatOpen}
        className={`hidden flex-col overflow-hidden bg-surface md:static md:z-auto md:flex md:h-auto md:transition-none ${
          chatOpen ? 'md:border-l md:border-l-[#eee]' : ''
        }`}
      >
        {!isMobile && <ChatPanel docId={id} onCite={jump} version={version} slugs={slugs} />}
      </aside>

      {/*
        移动端问答面板:antd Drawer,高度 70dvh(iOS 键盘弹起时 dvh 会跟着收缩,
        不会像 vh 那样遮住发送按钮)。底部条的高度补偿见 index.css 里的
        .reader-chat-drawer 规则。
      */}
      {isMobile && (
        <Drawer
          id="chat-panel"
          placement="bottom"
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          height="70dvh"
          closable={false}
          styles={{ body: { padding: 0, overflow: 'hidden' } }}
          rootClassName="reader-chat-drawer"
        >
          <ChatPanel docId={id} onCite={jump} version={version} slugs={slugs} />
        </Drawer>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 正文顶部的版本条。只有一个版本时不渲染 —— 没得选的时候不该占地方。 */
function VersionBar({ versions, current, isOld, latest, onSwitch }: {
  versions: DocumentVersion[]
  current: number | undefined
  isOld: boolean
  latest: DocumentVersion | null
  onSwitch: (v: number) => void
}) {
  const viewing = versions.find(v => v.version === current)
  return (
    <div className="mb-6 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#777]">
        <span>版本</span>
        <Select
          size="small"
          value={current}
          onChange={onSwitch}
          popupMatchSelectWidth={false}
          aria-label="选择版本"
          // 下拉里从新到旧:最常切的是最近几版
          options={[...versions].reverse().map(v => ({
            value: v.version,
            label: (
              <span>
                v{v.version} · {formatDate(v.created_at)}
                {v.version === latest?.version && <span className="ml-1.5 text-[#999]">最新</span>}
                {v.note && <span className="ml-1.5 text-[#999]">— {v.note}</span>}
              </span>
            ),
          }))}
          labelRender={() => (viewing ? `v${viewing.version} · ${formatDate(viewing.created_at)}` : '')}
        />
        {!isOld && viewing?.note && <span className="text-[#999]">{viewing.note}</span>}
      </div>
      {isOld && latest && viewing && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-gold-edge bg-gold-wash px-3 py-2 text-[13px] text-gold-ink"
        >
          <span>
            正在查看 v{viewing.version}({formatDate(viewing.created_at)}),最新为 v{latest.version}
            {latest.note ? `:${latest.note}` : ''}
          </span>
          <button
            type="button"
            className="cursor-pointer font-medium underline underline-offset-2"
            onClick={() => onSwitch(latest.version)}
          >
            切到最新
          </button>
        </div>
      )}
    </div>
  )
}
