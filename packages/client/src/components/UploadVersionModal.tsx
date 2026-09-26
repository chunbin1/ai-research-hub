import { useState } from 'react'
import { Modal, Upload, Input, Alert } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { api } from '../api'
import type { Document } from '../types'

/**
 * 给一篇已有的研报上传新版本。旧版本原样保留,读者在阅读页可以切回去看、
 * 针对旧版本提问。更新说明会出现在阅读页的版本下拉里,帮读者判断该看哪一版。
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
      okButtonProps={{ disabled: !file || busy }}
      onOk={() => void submit()}
      onCancel={() => { reset(); onClose() }}
      destroyOnHidden
    >
      <p className="mb-4 text-[13px] leading-[1.7] text-[#777]">
        「{doc?.filename}」目前是 v{doc?.latest_version ?? 1}。新版本上传后成为默认显示的版本,
        旧版本保留,读者可以在阅读页切换。
      </p>

      <Upload
        accept=".md,.markdown,.txt"
        showUploadList={false}
        beforeUpload={f => { setFile(f); setError(''); return false }}
      >
        <button
          type="button"
          className="flex items-center gap-2 rounded-[4px] border border-[#d9d9d9] bg-white px-3 py-[7px] text-[13px] text-[#333] hover:border-[#999]"
        >
          <UploadOutlined aria-hidden />
          {file ? file.name : '选择文件(.md / .markdown / .txt)'}
        </button>
      </Upload>

      <label className="mt-4 mb-1.5 block text-[13px] text-[#555]" htmlFor="version-note">
        更新说明(可选)
      </label>
      <Input.TextArea
        id="version-note"
        value={note}
        onChange={e => setNote(e.target.value)}
        maxLength={200}
        showCount
        autoSize={{ minRows: 2, maxRows: 4 }}
        placeholder="例如:加入 Q3 财报数据,上调目标价"
      />

      {error && <Alert type="error" showIcon className="mt-4" title={error} />}
    </Modal>
  )
}
