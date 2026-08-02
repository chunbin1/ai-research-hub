import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import { extractToc } from '../lib/toc'
import { useIsMobile } from '../hooks/useIsMobile'
import ReportMarkdown from '../components/ReportMarkdown'
import ChatPanel from '../components/ChatPanel'

const CHAT_OPEN_KEY = 'reader.chatOpen'

export default function ReaderPage() {
  const { id = '' } = useParams()
  const isMobile = useIsMobile()
  const [markdown, setMarkdown] = useState('')
  const [filename, setFilename] = useState('')
  const [error, setError] = useState('')
  const [tocOpen, setTocOpen] = useState(false)
  // 桌面:沿用 localStorage 记忆,默认展开。
  // 手机:恒为收起且不写 localStorage——否则一进阅读页就被 70dvh 面板盖掉大半正文。
  // 跨断点缩放窗口时不重置该值:它在两侧语义一致(问答是否可见),重置会让面板莫名开合。
  const [chatOpen, setChatOpen] = useState(() =>
    isMobile ? false : localStorage.getItem(CHAT_OPEN_KEY) !== '0',
  )

  useEffect(() => {
    api.getDocument(id)
      .then(({ document: doc, markdown }) => {
        setMarkdown(markdown)
        setFilename(doc.filename)
        document.title = `${doc.filename} — 研报站`
      })
      .catch(e => setError(String(e.message)))
  }, [id])

  // 抽屉打开时锁住背景滚动,否则正文会跟着抽屉一起滑
  useEffect(() => {
    if (!tocOpen || !isMobile) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [tocOpen, isMobile])

  const toc = extractToc(markdown)

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
  }

  if (error) {
    return (
      <div className="p-10">
        <Link to="/" className="mb-4 block text-[14px] text-[#555] hover:text-black">← 全部报告</Link>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div
      className={`relative flex h-dvh flex-col md:grid md:h-screen md:transition-[grid-template-columns] md:duration-[240ms] md:ease-[ease] motion-reduce:md:transition-none ${
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
            // 抽屉和问答面板都是 z-30,叠在一起时下层够不着遮罩、也点不动——
            // 打开抽屉的同时收起问答面板(仅移动端;不写 localStorage,与 jump() 一致)。
            if (isMobile) setChatOpen(false)
          }}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-lg text-[#555]"
        >
          ☰
        </button>
        <span className="truncate text-sm font-medium">{filename}</span>
      </header>

      {/* 抽屉遮罩:仅移动端 */}
      {tocOpen && (
        <div
          data-testid="toc-mask"
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setTocOpen(false)}
        />
      )}

      <aside
        id="toc-drawer"
        inert={isMobile && !tocOpen}
        className={`fixed inset-y-0 left-0 z-30 w-70 overflow-y-auto border-r border-[#eee] bg-surface px-3 py-5 transition-transform duration-[240ms] motion-reduce:transition-none md:static md:z-auto md:w-[240px] md:translate-x-0 md:transition-none ${
          tocOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Link to="/" className="mb-4 block text-[14px] text-[#555] hover:text-black">← 全部报告</Link>
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
      </aside>

      <main id="report-content" className="report-body flex-1 overflow-y-auto px-5 py-6 md:px-14 md:py-10">
        <ReportMarkdown markdown={markdown} />
      </main>

      {/*
        toggle 按钮:移动端是流内的底部整条(z-40 压住收起态滑出屏外的面板);
        桌面端是贴在问答栏左沿的 18×60 竖条。始终在 <aside> 外面,
        这样面板 inert 时按钮依然可点。
      */}
      <button
        type="button"
        onClick={toggleChat}
        aria-expanded={chatOpen}
        aria-controls="chat-panel"
        title={chatOpen ? '收起问答栏' : '展开问答栏'}
        className={`relative z-40 flex h-[calc(2.75rem+env(safe-area-inset-bottom))] w-full flex-none cursor-pointer items-center justify-center border-t border-[#eee] bg-white text-sm text-[#555] pb-[env(safe-area-inset-bottom)] md:absolute md:top-1/2 md:z-5 md:h-15 md:w-[18px] md:-translate-y-1/2 md:rounded-l-lg md:border md:border-r-0 md:border-[#eee] md:bg-white md:p-0 md:text-[13px] md:leading-[1] md:text-[#999] md:transition-[right,color,background] md:duration-[240ms] md:ease-[ease] md:hover:bg-[#f3f3f0] md:hover:text-black motion-reduce:md:transition-none ${
          chatOpen ? 'md:right-[360px]' : 'md:right-0'
        }`}
      >
        <span className="md:hidden">{chatOpen ? '收起问答 ▽' : '问这篇报告 △'}</span>
        <span className="hidden md:inline">{chatOpen ? '›' : '‹'}</span>
      </button>

      {/*
        问答面板:移动端 fixed 在 toggle 条(h-11 = 44px)正上方,两者不重叠;
        桌面端回到 grid 第三列,收起时列宽压到 0、面板被 overflow-hidden 裁掉。
        高度用 dvh 不用 vh:iOS 键盘弹起时 vh 不变会遮住发送按钮。
      */}
      <aside
        id="chat-panel"
        inert={!chatOpen}
        className={`fixed inset-x-0 bottom-[calc(2.75rem+env(safe-area-inset-bottom))] z-30 flex h-[70dvh] flex-col overflow-hidden border-t border-[#eee] bg-surface transition-transform duration-[240ms] motion-reduce:transition-none md:static md:z-auto md:h-auto md:translate-y-0 md:border-t-0 md:transition-none ${
          chatOpen ? 'translate-y-0' : 'translate-y-full'
        } ${chatOpen ? 'md:border-l md:border-l-[#eee]' : ''}`}
      >
        <ChatPanel docId={id} onCite={jump} />
      </aside>
    </div>
  )
}
