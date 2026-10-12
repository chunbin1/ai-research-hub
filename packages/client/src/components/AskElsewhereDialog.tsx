import { useState } from 'react'
import { UploadDialog } from './UploadDialog'
import { askPrompt, mcpUrl, setupGuides } from '../lib/askElsewhere'

/**
 * 剪贴板 API 只在 https / localhost 可用,微信等内置浏览器也常拒绝;
 * 退一步用临时 textarea + execCommand。都不行时调用方让用户手动选中复制。
 */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      ta.remove()
    }
  }
}

/**
 * 「去 Claude / Codex / Grok 里问」:复制一段带研报 id 的提问文案,
 * 粘到装了研报站 MCP 连接器的 AI 里接着问。首次使用的配置说明折叠在下面。
 */
export function AskElsewhereDialog({ open, onClose, docId, title, version, isLatest }: {
  open: boolean
  onClose: () => void
  docId: string
  title: string
  version?: number
  isLatest: boolean
}) {
  const prompt = askPrompt({ docId, title, version, isLatest })
  const url = mcpUrl(window.location.origin)
  /** 刚复制成功的是哪一段:'prompt' 或某个配置代码块 */
  const [copied, setCopied] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  async function copyAs(key: string, text: string) {
    const ok = await copy(text)
    setFailed(!ok)
    setCopied(ok ? key : null)
  }

  function close() {
    setCopied(null)
    setFailed(false)
    onClose()
  }

  return (
    <UploadDialog
      open={open}
      title="去 Claude / Codex / Grok 里问"
      okText={copied === 'prompt' ? '已复制' : '复制文案'}
      okDisabled={false}
      onOk={() => void copyAs('prompt', prompt)}
      onCancel={close}
    >
      <div className="flex flex-col gap-4 font-sans-sc text-[14px] text-ink">
        <p className="m-0 leading-[1.7] text-ink-mute">
          复制下面的文案,粘到已添加研报站连接器的 AI 里,在末尾写上你的问题。AI 会自己读这篇报告的目录和相关章节。
        </p>
        <textarea
          readOnly
          aria-label="提问文案"
          value={prompt}
          rows={6}
          onFocus={e => e.currentTarget.select()}
          className="w-full resize-none rounded border border-edge bg-page p-3 font-mono text-[12.5px] leading-[1.6] text-ink outline-none focus:border-navy"
        />
        {failed && <p className="m-0 text-[13px] text-danger">浏览器不让自动复制,请在上面的框里全选后手动复制。</p>}

        <details className="group rounded border border-row-rule">
          <summary className="cursor-pointer select-none px-3 py-2.5 text-[13px] text-ink-soft">
            第一次用?先添加研报站连接器
          </summary>
          <div className="flex flex-col gap-3.5 border-t border-row-rule px-3 py-3">
            {setupGuides(url).map(g => (
              <div key={g.client} className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">{g.client}</span>
                <span className="text-[12.5px] leading-[1.6] text-ink-mute">{g.how}</span>
                {g.code && (
                  <div className="flex items-start gap-2">
                    <pre className="m-0 min-w-0 flex-1 overflow-x-auto whitespace-pre rounded bg-aside px-2.5 py-2 font-mono text-[12px] leading-[1.55]">{g.code}</pre>
                    <button
                      type="button"
                      onClick={() => void copyAs(g.client, g.code!)}
                      className="flex-none cursor-pointer rounded border border-edge px-2 py-1.5 text-[12px] text-ink-soft hover:border-navy hover:text-navy"
                    >
                      {copied === g.client ? '已复制' : '复制'}
                    </button>
                  </div>
                )}
              </div>
            ))}
            <p className="m-0 text-[12px] leading-[1.6] text-ink-faint">
              连接器只读:能列出研报、看目录、读正文和股票信号,不能上传或修改任何东西。
            </p>
          </div>
        </details>
      </div>
    </UploadDialog>
  )
}
