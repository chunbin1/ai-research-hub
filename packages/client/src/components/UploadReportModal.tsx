import { useRef, useState } from 'react'
import { Modal, Alert, Input, Radio } from 'antd'
import { api } from '../api'
import type { SimilarReport } from '../types'
import { ReportDropZone } from './ReportDropZone'

type Check =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; candidates: SimilarReport[] }
  | { status: 'failed' }

/** 选择:'new' = 新建一篇;否则是要追加新版本的那篇研报的 id */
type Choice = 'new' | string

/**
 * 上传一篇新研报。顶栏「上传研报」按钮(桌面带字 / 移动端图标)点开的弹窗,
 * 与「上传新版本」弹窗同一套外观:大拖拽区选文件(拖入或点击),点「上传」才提交。
 *
 * 选好文件先查重:库里有标题相近、或正文大段重合的研报,就把它们列出来,
 * 让管理员自己选「作为它的新版本」还是「新建一篇」—— 标题常常只改了一部分,
 * 光凭记忆很容易把同一篇传成两篇。不选不让传。
 */
export function UploadReportModal({ open, onClose, onUploaded }: {
  open: boolean
  onClose: () => void
  onUploaded: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [check, setCheck] = useState<Check>({ status: 'idle' })
  const [choice, setChoice] = useState<Choice | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 连着换文件时,只认最后一次查重的结果
  const checkSeq = useRef(0)

  const candidates = check.status === 'done' ? check.candidates : []
  // 没有候选(或查重失败)就只能新建,不用选
  const target: Choice | null = candidates.length ? choice : 'new'
  const targetDoc = candidates.find(c => c.document.id === target)?.document

  function reset() {
    checkSeq.current++
    setFile(null)
    setCheck({ status: 'idle' })
    setChoice(null)
    setNote('')
    setError('')
  }

  async function pick(f: File) {
    setFile(f)
    setChoice(null)
    setError('')
    const seq = ++checkSeq.current
    setCheck({ status: 'checking' })
    try {
      const { candidates } = await api.checkSimilar(f)
      if (seq === checkSeq.current) setCheck({ status: 'done', candidates })
    } catch {
      if (seq === checkSeq.current) setCheck({ status: 'failed' })
    }
  }

  async function submit() {
    if (!file || target === null) return
    setBusy(true)
    setError('')
    try {
      if (target === 'new') await api.uploadDocument(file)
      else await api.uploadVersion(target, file, note)
      reset()
      onUploaded()
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="上传研报"
      okText={busy ? '上传中…' : targetDoc ? '上传为新版本' : '上传'}
      cancelText="取消"
      // 两个汉字的按钮 antd 默认会插空格(「上 传」),和站内其他按钮不一致
      okButtonProps={{
        disabled: !file || busy || check.status === 'checking' || target === null,
        autoInsertSpace: false,
      }}
      cancelButtonProps={{ autoInsertSpace: false, disabled: busy }}
      onOk={() => void submit()}
      onCancel={() => { if (busy) return; reset(); onClose() }}
      destroyOnHidden
      width={640}
    >
      <p className="mb-4 text-[13px] leading-[1.7] text-[#777]">
        上传后自动切段、建索引,完成后出现在研报列表里。
      </p>

      <ReportDropZone
        selectedName={file?.name}
        disabled={busy}
        onFile={f => void pick(f)}
      />

      {check.status === 'checking' && (
        <p className="m-0 mt-3 text-[13px] text-ink-mute">正在查找库里有没有这篇的旧版本…</p>
      )}
      {check.status === 'failed' && (
        <p className="m-0 mt-3 text-[13px] text-ink-mute">没能查重,上传会新建一篇。</p>
      )}

      {candidates.length > 0 && (
        <div className="mt-4 rounded-[6px] border border-warn-edge bg-[#FDFAF4] px-4 py-3">
          <p className="m-0 mb-1 text-[14px] text-ink">库里可能已有这篇的旧版本</p>
          <p className="m-0 mb-3 text-[12px] leading-[1.6] text-ink-mute">
            作为新版本上传时,旧版本原样保留,读者可以在阅读页切回去看。
          </p>
          <Radio.Group
            value={choice}
            onChange={e => setChoice(e.target.value as Choice)}
            disabled={busy}
            className="flex flex-col gap-2.5"
          >
            {candidates.map(c => (
              <Radio key={c.document.id} value={c.document.id}>
                <span className="text-[14px] text-ink">
                  作为「{c.document.filename}」的新版本 v{(c.document.latest_version ?? 1) + 1}
                </span>
                <span className="block text-[12px] text-ink-faint">{describe(c)}</span>
              </Radio>
            ))}
            <Radio value="new">
              <span className="text-[14px] text-ink">新建一篇</span>
              <span className="block text-[12px] text-ink-faint">和上面的都不是同一篇</span>
            </Radio>
          </Radio.Group>
        </div>
      )}

      {targetDoc && (
        <>
          <label className="mt-4 mb-1.5 block text-[13px] text-[#555]" htmlFor="report-version-note">
            更新说明(可选)
          </label>
          <Input.TextArea
            id="report-version-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={200}
            showCount
            // 字数统计是绝对定位挂在输入框下方的,不留出空间会压到底部按钮
            className="mb-6"
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="例如:加入 Q3 财报数据,上调目标价"
          />
        </>
      )}

      {error && <Alert type="error" showIcon className="mt-4" title={error} />}
    </Modal>
  )
}

/** 「标题相近 · 正文重合 98% · 目前 v1,9/25 更新」—— 给人判断是不是同一篇的依据 */
function describe(c: SimilarReport): string {
  const parts: string[] = []
  if (c.titleScore >= 1) parts.push('标题相同')
  else if (c.titleScore > 0) parts.push('标题相近')
  parts.push(`正文重合 ${Math.round(c.contentScore * 100)}%`)
  const d = c.document
  const at = d.updated_at ?? d.created_at
  const date = new Date(at)
  parts.push(`目前 v${d.latest_version ?? 1},${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} 更新`)
  return parts.join(' · ')
}
