import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Drawer } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import { api } from '../api'
import { extractToc } from '../lib/toc'
import { useIsMobile } from '../hooks/useIsMobile'
import ReportMarkdown from '../components/ReportMarkdown'
import ChatPanel from '../components/ChatPanel'
import { BackLink } from '../components/BackLink'

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
        {!isMobile && <ChatPanel docId={id} onCite={jump} />}
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
          <ChatPanel docId={id} onCite={jump} />
        </Drawer>
      )}
    </div>
  )
}
