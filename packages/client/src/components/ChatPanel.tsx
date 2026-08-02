import { useState } from 'react'
import { useDocChat } from '../hooks/useDocChat'
import { useAuth } from '../hooks/useAuth'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './ChatPanel.module.css'

export default function ChatPanel({ docId, onCite }: { docId: string; onCite: (slug: string) => void }) {
  const { messages, send, streaming } = useDocChat(docId)
  const { user, login } = useAuth()
  const [input, setInput] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    void send(text).then(() => window.dispatchEvent(new Event('auth:refresh')))
  }

  const outOfQuota = user && !user.unlimited && (user.remaining ?? 0) <= 0

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        问这篇报告
        {user && !user.unlimited && <span className={styles.quota}>剩余 {user.remaining}</span>}
      </div>
      <div className={styles.messages}>
        {messages.length === 0 && <p className={styles.hint}>就当前报告提问,答案会标注来源章节。</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? styles.user : `${styles.assistant} chat-md`}>
            {m.role === 'assistant'
              ? <Markdown remarkPlugins={[remarkGfm]}>{m.content || '…'}</Markdown>
              : m.content}
            {m.sources && m.sources.length > 0 && (
              <div className={styles.sources}>
                {m.sources.map((s, j) => (
                  <button key={j} className={styles.chip} onClick={() => onCite(s.section_slug)}>
                    来源 §{s.section_title || '引言'}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {user ? (
        <form className={styles.inputRow} onSubmit={submit}>
          <input value={input} onChange={e => setInput(e.target.value)}
                 placeholder={outOfQuota ? '次数已用完' : streaming ? '生成中…' : '输入问题,回车发送'}
                 disabled={streaming || !!outOfQuota} />
          <button type="submit" disabled={streaming || !!outOfQuota || !input.trim()}>发送</button>
        </form>
      ) : (
        <div className={styles.loginPrompt}>
          <span>登录后即可就本篇报告提问</span>
          <button className={styles.loginBtn} onClick={login}>GitHub 登录</button>
        </div>
      )}
    </div>
  )
}
