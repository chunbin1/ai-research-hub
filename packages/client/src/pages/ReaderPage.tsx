import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import { extractToc } from '../lib/toc'
import ReportMarkdown from '../components/ReportMarkdown'
import ChatPanel from '../components/ChatPanel'
import styles from './ReaderPage.module.css'

export default function ReaderPage() {
  const { id = '' } = useParams()
  const [markdown, setMarkdown] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.getDocument(id)
      .then(({ document, markdown }) => { setMarkdown(markdown); setTitle(document.filename) })
      .catch(e => setError(String(e.message)))
  }, [id])

  const toc = extractToc(markdown)

  // 溯源回链:滚动到章节标题并临时高亮
  function jump(slug: string) {
    const el = document.getElementById(slug)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.classList.remove('flash')
    void el.offsetWidth // 强制回流,便于重复点击重新触发动画
    el.classList.add('flash')
    window.setTimeout(() => el.classList.remove('flash'), 1600)
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
    <div className={styles.layout}>
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
        <h1 className={styles.docTitle}>{title}</h1>
        <ReportMarkdown markdown={markdown} />
      </main>
      <aside className={styles.chat}>
        <ChatPanel docId={id} onCite={jump} />
      </aside>
    </div>
  )
}
