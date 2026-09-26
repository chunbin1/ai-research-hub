import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpOutlined, CloseOutlined, RightOutlined } from '@ant-design/icons'
import { useDocChat } from '../hooks/useDocChat'
import { useAuth } from '../hooks/useAuth'
import { useLLMConfig } from '../hooks/useLLMConfig'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  docId: string
  onCite: (slug: string) => void
  /** 当前正在看的版本;提问针对它 */
  version?: number
  /** 当前版本里存在的章节锚点。不在里面的来源点了也跳不过去,渲染成普通文字。 */
  slugs?: ReadonlySet<string>
  /**
   * 外观。panel = 桌面右侧栏(「收起 ›」、方角输入框 + 发送);
   * sheet = 移动端底部弹层(拖拽把手、✕、胶囊输入框 + 圆形发送)。
   */
  variant?: 'panel' | 'sheet'
  /** 收起 / 关闭;不传就不出这个按钮 */
  onClose?: () => void
}

export default function ChatPanel({ docId, onCite, version, slugs, variant = 'panel', onClose }: Props) {
  const { messages, send, streaming } = useDocChat(docId, version)
  const { user, login } = useAuth()
  const [input, setInput] = useState('')
  const { data: llm } = useLLMConfig()
  const effective = llm?.effective ?? null
  const sheet = variant === 'sheet'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    void send(text).then(() => window.dispatchEvent(new Event('auth:refresh')))
  }

  // BYOK 用户消耗的是自己的 key,不占公共额度,不能被公共计数器挡住输入框,
  // 所以只有当前仍在用公共 key(effective.source === 'server')时才检查额度。
  const onServerQuota = !!user && !user.unlimited && effective?.source === 'server'
  const outOfQuota = onServerQuota && (user?.remaining ?? 0) <= 0

  return (
    <div className="flex h-full w-full flex-col bg-white font-sans-sc text-ink">
      {sheet && (
        <div className="flex flex-none justify-center pt-2" aria-hidden>
          <div className="h-1 w-9 rounded-full bg-edge" />
        </div>
      )}

      <div
        className={`flex flex-none items-start justify-between gap-3 border-b border-row-rule ${
          sheet ? 'pb-3.5 pl-5 pr-1.5 pt-2.5' : 'px-6 pb-4 pt-5'
        }`}
      >
        <div className={`flex min-w-0 flex-col ${sheet ? 'gap-1 pt-1.5' : 'gap-1.5'}`}>
          <span className="font-serif-sc text-[17px] font-semibold">问这篇报告</span>
          {user && effective && (
            <Link
              to="/settings"
              title="模型设置"
              className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-faint hover:text-navy md:text-[12px]"
            >
              <span className="font-mono">{effective.model}</span>
              <span>·</span>
              <span>{effective.source === 'user' ? '自带 key' : '公共额度'}</span>
              {onServerQuota && <span>· 剩余 {user?.remaining} 次</span>}
            </Link>
          )}
        </div>
        {onClose && (sheet
          ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭问答"
              className="flex size-11 flex-none items-center justify-center text-[16px] text-ink-mute"
            >
              <CloseOutlined aria-hidden />
            </button>
          )
          : (
            <button
              type="button"
              onClick={onClose}
              className="-mr-1.5 -mt-1 flex flex-none cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[13px] text-ink-mute hover:bg-aside hover:text-ink"
            >
              收起
              <RightOutlined aria-hidden className="text-[11px]" />
            </button>
          ))}
      </div>

      <div className={`flex flex-1 flex-col gap-4 overflow-y-auto ${sheet ? 'p-5' : 'p-6'}`}>
        {messages.length === 0 && (
          <p className="m-0 text-[14px] leading-[1.7] text-ink-mute">就当前报告提问,答案会标注来源章节。</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user'
                ? 'max-w-[85%] self-end rounded-[12px_12px_2px_12px] bg-navy px-3 py-2 text-[14px] leading-[1.6] text-page'
                : 'chat-md max-w-full self-start text-[14px] leading-[1.75] text-[#2A2D33]'
            }
          >
            {m.role === 'assistant'
              ? <Markdown remarkPlugins={[remarkGfm]}>{m.content || '…'}</Markdown>
              : m.content}
            {/* 回答基于的版本和正在看的不同时才标 —— 同一版本的标注只是噪音 */}
            {m.role === 'assistant' && m.version !== undefined && version !== undefined && m.version !== version && (
              <div className="mt-1.5 text-[12px] text-ink-faint">基于 v{m.version}</div>
            )}
            {m.sources && m.sources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.sources.map((s, j) => (
                  // 引言块没有锚点(slug 为空),版本化之前也是这样,不算失效
                  !slugs || !s.section_slug || slugs.has(s.section_slug)
                    ? (
                      <button
                        key={j}
                        className="cursor-pointer rounded-[3px] border border-navy-edge bg-navy-wash px-2 py-[3px] text-[12px] text-navy hover:border-navy"
                        onClick={() => onCite(s.section_slug)}
                      >
                        来源 §{s.section_title || '引言'}
                      </button>
                    )
                    : (
                      <span
                        key={j}
                        title="这一节在当前版本里没有"
                        className="rounded-[3px] border border-row-rule px-2 py-[3px] text-[12px] text-ink-faint"
                      >
                        来源 §{s.section_title || '引言'}
                      </span>
                    )
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {user ? (
        <form
          className={`flex flex-none gap-2 border-t border-row-rule ${
            sheet ? 'px-3.5 pb-[max(1.375rem,env(safe-area-inset-bottom))] pt-2.5' : 'px-6 pb-5 pt-4'
          }`}
          onSubmit={submit}
        >
          <input
            className={`min-w-0 flex-1 border border-edge bg-page text-ink outline-none focus:border-navy disabled:opacity-60 ${
              sheet ? 'h-[46px] rounded-full px-4 text-[15px]' : 'rounded px-3 py-2.5 text-[14px]'
            }`}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={outOfQuota ? '次数已用完' : streaming ? '生成中…' : sheet ? '输入问题' : '输入问题,回车发送'}
            disabled={streaming || outOfQuota}
          />
          {sheet
            ? (
              <button
                type="submit"
                aria-label="发送"
                className="flex size-[46px] flex-none cursor-pointer items-center justify-center rounded-full bg-navy text-[16px] text-page disabled:cursor-default disabled:opacity-40"
                disabled={streaming || outOfQuota || !input.trim()}
              >
                <ArrowUpOutlined aria-hidden />
              </button>
            )
            : (
              <button
                type="submit"
                className="flex-none cursor-pointer rounded bg-navy px-4 text-[13px] font-medium text-page hover:bg-[#14304D] disabled:cursor-default disabled:opacity-40"
                disabled={streaming || outOfQuota || !input.trim()}
              >
                发送
              </button>
            )}
        </form>
      ) : (
        <div className="flex flex-none flex-col items-center gap-2.5 border-t border-row-rule px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[14px] text-ink-mute">
          <span>登录后即可就本篇报告提问</span>
          <button
            className="cursor-pointer rounded bg-navy px-4 py-[9px] text-[13px] font-medium text-page"
            onClick={login}
          >
            GitHub 登录
          </button>
        </div>
      )}
    </div>
  )
}
