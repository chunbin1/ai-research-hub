import { useEffect, useState } from 'react'
import { Modal, Upload, Input, Alert } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { api } from '../api'
import { useFileDrop } from '../hooks/useFileDrop'
import { REPORT_ACCEPT, pickReportFile } from '../lib/reportUpload'
import type { Document } from '../types'

/**
 * 给一篇已有的研报上传新版本。旧版本原样保留,读者在阅读页可以切回去看、
 * 针对旧版本提问。更新说明会出现在阅读页的版本下拉里,帮读者判断该看哪一版。
 *
 * 选文件三条路:点「选择文件」、把文件拖进弹窗、或在首页直接把文件拖到那篇研报的
 * 行上(弹窗打开时带着 initialFile)。三条都走 pickReportFile 的同一套校验,
 * 都只是选中,仍要点「上传」才提交 —— 留出写更新说明的机会。
 */
export function UploadVersionModal({ doc, initialFile = null, onClose, onUploaded }: {
  /** null 时不显示 */
  doc: Document | null
  /** 打开时预先选中的文件(首页拖到行上) */
  initialFile?: File | null
  onClose: () => void
  onUploaded: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 每次针对一篇研报打开时,带上预选文件
  useEffect(() => {
    if (doc) { setFile(initialFile); setError('') }
  }, [doc, initialFile])

  function reset() {
    setFile(null)
    setNote('')
    setError('')
  }

  function choose(files: File[]) {
    const picked = pickReportFile(files)
    if (picked.error !== undefined) { setError(picked.error); return }
    setFile(picked.file)
    setError('')
  }

  // 整个弹窗内容区都收拖拽(按钮太小,不好对准),拖进来时「选择文件」按钮高亮
  const { dragging, dropProps } = useFileDrop(choose, busy)

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
    >
      <div data-testid="version-drop-area" data-dragging={dragging || undefined} {...dropProps}>
        <p className="mb-4 text-[13px] leading-[1.7] text-[#777]">
          「{doc?.filename}」目前是 v{doc?.latest_version ?? 1}。新版本上传后成为默认显示的版本,
          旧版本保留,读者可以在阅读页切换。
        </p>

        <Upload
          accept={REPORT_ACCEPT}
          showUploadList={false}
          beforeUpload={f => { choose([f]); return false }}
        >
          <button
            type="button"
            className={`flex items-center gap-2 rounded-[4px] border px-3 py-[7px] text-[13px] transition-[border-color,background] duration-150 ${
              dragging
                ? 'border-dashed border-navy bg-navy-wash text-navy'
                : 'border-[#d9d9d9] bg-white text-[#333] hover:border-[#999]'
            }`}
          >
            <UploadOutlined aria-hidden />
            {dragging
              ? '松开即可选择这个文件'
              : file ? file.name : '选择文件(.md / .markdown / .txt),或拖拽到此处'}
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
          // 字数统计是绝对定位挂在输入框下方的,不留出空间会压到底部按钮
          className="mb-6"
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder="例如:加入 Q3 财报数据,上调目标价"
        />

        {error && <Alert type="error" showIcon className="mt-4" title={error} />}
      </div>
    </Modal>
  )
}
