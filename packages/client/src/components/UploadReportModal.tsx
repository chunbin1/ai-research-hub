import { useState } from 'react'
import { Modal, Alert } from 'antd'
import { api } from '../api'
import { ReportDropZone } from './ReportDropZone'

/**
 * 上传一篇新研报。顶栏「上传研报」按钮(桌面带字 / 移动端图标)点开的弹窗,
 * 与「上传新版本」弹窗同一套外观:大拖拽区选文件(拖入或点击),点「上传」才提交。
 */
export function UploadReportModal({ open, onClose, onUploaded }: {
  open: boolean
  onClose: () => void
  onUploaded: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setFile(null)
    setError('')
  }

  async function submit() {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await api.uploadDocument(file)
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
      okText={busy ? '上传中…' : '上传'}
      cancelText="取消"
      // 两个汉字的按钮 antd 默认会插空格(「上 传」),和站内其他按钮不一致
      okButtonProps={{ disabled: !file || busy, autoInsertSpace: false }}
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
        onFile={f => { setFile(f); setError('') }}
      />

      {error && <Alert type="error" showIcon className="mt-4" title={error} />}
    </Modal>
  )
}
