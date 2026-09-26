import { useState } from 'react'
import { Modal, Input, Alert } from 'antd'
import { ReportDropZone } from './ReportDropZone'
import { api } from '../api'
import type { Document } from '../types'

/**
 * 给一篇已有的研报上传新版本。旧版本原样保留,读者在阅读页可以切回去看、
 * 针对旧版本提问。更新说明会出现在阅读页的版本下拉里,帮读者判断该看哪一版。
 *
 * 文件在大拖拽区里选(拖入或点击),与「上传研报」弹窗同一个组件、同一套校验。
 */
export function UploadVersionModal({ doc, onClose, onUploaded }: {
  /** null 时不显示 */
  doc: Document | null
  onClose: () => void
  onUploaded: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setFile(null)
    setNote('')
    setError('')
  }

  async function submit() {
    if (!doc || !file) return
    setBusy(true)
    setError('')
    try {
      await api.uploadVersion(doc.id, file, note)
      reset()
      onUploaded()
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  const next = (doc?.latest_version ?? 1) + 1

  return (
    <Modal
      open={doc !== null}
      title={`上传新版本 v${next}`}
      okText={busy ? '上传中…' : '上传'}
      cancelText="取消"
      // 两个汉字的按钮 antd 默认会插空格(「上 传」),和站内其他按钮不一致
      okButtonProps={{ disabled: !file || busy, autoInsertSpace: false }}
      cancelButtonProps={{ autoInsertSpace: false }}
      onOk={() => void submit()}
      onCancel={() => { reset(); onClose() }}
      destroyOnHidden
      width={640}
    >
      <p className="mb-4 text-[13px] leading-[1.7] text-[#777]">
        「{doc?.filename}」目前是 v{doc?.latest_version ?? 1}。新版本上传后成为默认显示的版本,
        旧版本保留,读者可以在阅读页切换。
      </p>

      <ReportDropZone
        selectedName={file?.name}
        disabled={busy}
        onFile={f => { setFile(f); setError('') }}
      />

      <label className="mt-4 mb-1.5 block text-[13px] text-[#555]" htmlFor="version-note">
        更新说明(可选)
      </label>
      <Input.TextArea
        id="version-note"
        value={note}
        onChange={e => setNote(e.target.value)}
        maxLength={200}
        showCount
        // 字数统计是绝对定位挂在输入框下方的,不留出空间会压到底部按钮
        className="mb-6"
        autoSize={{ minRows: 2, maxRows: 4 }}
        placeholder="例如:加入 Q3 财报数据,上调目标价"
      />

      {error && <Alert type="error" showIcon className="mt-4" title={error} />}
    </Modal>
  )
}
