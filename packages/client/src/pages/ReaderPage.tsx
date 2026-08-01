import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import { extractToc } from '../lib/toc'
import ReportMarkdown from '../components/ReportMarkdown'
import ChatPanel from '../components/ChatPanel'
import styles from './ReaderPage.module.css'

const CHAT_OPEN_KEY = 'reader.chatOpen'

export default function ReaderPage() {
  const { id = '' } = useParams()
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState('')
  // 默认展开;收起状态记在 localStorage,换报告/刷新后保持
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem(CHAT_OPEN_KEY) !== '0')

  useEffect(() => {
    api.getDocument(id)
      .then(({ document: doc, markdown }) => {
        setMarkdown(markdown)
        document.title = `${doc.filename} — 研报站`
      })
      .catch(e => setError(String(e.message)))
  }, [id])

  const toc = extractToc(markdown)

  // 溯源回链:滚动到章节标题并临时高亮。
  // 注:显式滚动 #report-content 容器,而非 el.scrollIntoView()——后者对
  // 嵌套滚动容器 + smooth 存在浏览器兼容问题,常常不生效。
  function jump(slug: string) {
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
      localStorage.setItem(CHAT_OPEN_KEY, open ? '0' : '1')
      return !open
    })
  }

  if (error) {
    return (
      <div className={styles.errorPage}>
        <Link to="/" className={styles.back}>← 全部报告</Link>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div className={`${styles.layout} ${chatOpen ? '' : styles.collapsed}`}>
      <aside className={styles.toc}>
        <Link to="/" className={styles.back}>← 全部报告</Link>
        <nav>
          {toc.map((t, i) => (
            <a key={i} className={styles.tocItem} style={{ paddingLeft: 8 + (t.level - 1) * 12 }}
               onClick={() => jump(t.slug)}>{t.title}</a>
          ))}
        </nav>
      </aside>
      <main className={styles.content} id="report-content">
        <ReportMarkdown markdown={markdown} />
      </main>
      <button
        className={styles.chatToggle}
        onClick={toggleChat}
        aria-expanded={chatOpen}
        aria-controls="chat-panel"
        title={chatOpen ? '收起问答栏' : '展开问答栏'}
      >
        {chatOpen ? '›' : '‹'}
      </button>
      <aside className={styles.chat} id="chat-panel" inert={!chatOpen}>
        <ChatPanel docId={id} onCite={jump} />
      </aside>
    </div>
  )
}
