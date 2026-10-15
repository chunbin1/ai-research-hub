import { useRef, useState } from 'react'
import { Alert, Modal } from 'antd'
import { AntdProvider } from '../antd/AntdProvider'
import type { Document } from '../types'

/** 删除确认。按需加载,避免首页首屏带上 antd Modal。 */
export function ConfirmDelete({ doc, onCancel, onOk }: {
  doc: Document
  onCancel: () => void
  onOk: () => Promise<void>
}) {
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [error, setError] = useState('')
  // confirmLoading 要等下一次渲染才禁用按钮,同一轮连点会在那之前打进两次 onOk
  const pending = useRef(false)

  async function handleOk() {
    if (pending.current) return
    pending.current = true
    setConfirmLoading(true)
    setError('')
    try {
      await onOk()
    } catch (e) {
      // 失败留在弹窗里:页面上的错误横幅在遮罩后面,看不见
      setError(e instanceof Error ? e.message : '删除失败')
    } finally {
      pending.current = false
      setConfirmLoading(false)
    }
  }

  return (
    <AntdProvider>
      <Modal
        open
        title="删除这篇报告?"
        okText="删除"
        cancelText="取消"
        confirmLoading={confirmLoading}
        okButtonProps={{ danger: true, autoInsertSpace: false }}
        cancelButtonProps={{ autoInsertSpace: false, disabled: confirmLoading }}
        onOk={() => { void handleOk() }}
        onCancel={() => { if (pending.current) return; onCancel() }}
      >
        {doc.filename}
        {error && <Alert type="error" showIcon className="mt-3" title={error} />}
      </Modal>
    </AntdProvider>
  )
}
