import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDocChat } from '../hooks/useDocChat'
import { useAuth } from '../hooks/useAuth'
import { useLLMConfig } from '../hooks/useLLMConfig'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function ChatPanel({ docId, onCite }: { docId: string; onCite: (slug: string) => void }) {
  const { messages, send, streaming } = useDocChat(docId)
  const { user, login } = useAuth()
  const [input, setInput] = useState('')
  const { data: llm } = useLLMConfig()
  const effective = llm?.effective ?? null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    void send(text).then(() => window.dispatchEvent(new Event('auth:refresh')))
  }

  const outOfQuota = user && !user.unlimited && (user.remaining ?? 0) <= 0

  return (
    // h-full:高度由父级 aside 决定(移动 70dvh / 桌面撑满 grid 行)
    // w-full md:w-[360px] flex-none:桌面收起时父级列宽压到 0,靠固定宽度 + 不压缩保持面板整体滑出
    <div className="flex h-full w-full flex-none flex-col md:w-[360px]">
      <div className="flex-none border-b border-[#eee]">
        <div className="flex items-center justify-between p-4 pb-2 font-semibold">
          问这篇报告
          {user && !user.unlimited && effective?.source === 'server' && (
            <span className="rounded-full border border-gold-edge bg-gold-wash px-2 py-0.5 text-[12px] text-gold-ink">
              剩余 {user.remaining}
            </span>
          )}
        </div>
        {user && effective && (
          <Link
            to="/settings"
            className="flex items-center gap-1.5 px-4 pb-2.5 text-[12px] text-[#999] hover:text-[#555]"
          >
            <span className="font-mono">{effective.model}</span>
            <span>·</span>
            <span>{effective.source === 'user' ? '自带 key' : '公共额度'}</span>
            <span className="text-[#ccc]">⚙</span>
          </Link>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-[13px] text-[#999]">就当前报告提问,答案会标注来源章节。</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user'
                ? 'max-w-[85%] self-end rounded-[12px_12px_2px_12px] bg-[#1a1a1a] px-3 py-2 text-[14px] text-white'
                : 'chat-md max-w-full self-start text-sm leading-[1.7]'
            }
          >
            {m.role === 'assistant'
              ? <Markdown remarkPlugins={[remarkGfm]}>{m.content || '…'}</Markdown>
              : m.content}
            {m.sources && m.sources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.sources.map((s, j) => (
                  <button
                    key={j}
                    className="cursor-pointer rounded-full border border-gold bg-gold-wash px-2.5 py-[3px] text-[12px] text-gold-ink hover:bg-[#f3ead0]"
                    onClick={() => onCite(s.section_slug)}
                  >
                    来源 §{s.section_title || '引言'}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {user ? (
        <form
          className="flex flex-none gap-2 border-t border-[#eee] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3"
          onSubmit={submit}
        >
          <input
            className="flex-1 rounded-lg border border-[#ddd] px-3 py-[9px] text-[14px]"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={outOfQuota ? '次数已用完' : streaming ? '生成中…' : '输入问题,回车发送'}
            disabled={streaming || !!outOfQuota}
          />
          <button
            type="submit"
            className="cursor-pointer rounded-lg bg-[#1a1a1a] px-4 py-[9px] text-[13.33px] text-white disabled:cursor-default disabled:opacity-50"
            disabled={streaming || !!outOfQuota || !input.trim()}
          >
            发送
          </button>
        </form>
      ) : (
        <div className="flex flex-none flex-col items-center gap-2.5 border-t border-[#eee] px-4 py-5 text-[14px] text-[#666]">
          <span>登录后即可就本篇报告提问</span>
          <button
            className="cursor-pointer rounded-lg bg-[#1a1a1a] px-4 py-[9px] text-[13.33px] text-white"
            onClick={login}
          >
            GitHub 登录
          </button>
        </div>
      )}
    </div>
  )
}
