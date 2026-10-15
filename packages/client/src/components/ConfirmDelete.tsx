import { Modal } from 'antd'
import { AntdProvider } from '../antd/AntdProvider'
import type { Document } from '../types'

/** 删除确认。按需加载,避免首页首屏带上 antd Modal。 */
export function ConfirmDelete({ doc, onCancel, onOk }: {
  doc: Document
  onCancel: () => void
  onOk: () => Promise<void>
}) {
  return (
    <AntdProvider>
      <Modal
        open
        title="删除这篇报告?"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true, autoInsertSpace: false }}
        cancelButtonProps={{ autoInsertSpace: false }}
        onOk={onOk}
        onCancel={onCancel}
      >
        {doc.filename}
      </Modal>
    </AntdProvider>
  )
}
