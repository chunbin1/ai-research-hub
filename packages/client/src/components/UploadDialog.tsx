import type { ReactNode } from 'react'
import { Drawer, Modal } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { useIsMobile } from '../hooks/useIsMobile'

/**
 * 「上传研报」「上传新版本」两个弹窗的外壳:桌面是居中的 Modal,
 * 手机是从底部升起的抽屉 —— 与首页行菜单、阅读页版本 / 问答抽屉同一套样式
 * (顶部圆角 + 拖动条,胶囊按钮),拇指够得着底部的按钮。
 *
 * Modal 和 Drawer 只能挂一个,所以这里按 useIsMobile 分支,而不是靠 md: 前缀藏一份。
 */
export function UploadDialog({ open, title, okText, okDisabled, cancelDisabled, onOk, onCancel, children }: {
  open: boolean
  title: string
  okText: string
  okDisabled: boolean
  cancelDisabled?: boolean
  onOk: () => void
  onCancel: () => void
  children: ReactNode
}) {
  const isMobile = useIsMobile()

  if (!isMobile) {
    return (
      <Modal
        open={open}
        title={title}
        okText={okText}
        cancelText="取消"
        // 两个汉字的按钮 antd 默认会插空格(「上 传」),和站内其他按钮不一致
        okButtonProps={{ disabled: okDisabled, autoInsertSpace: false }}
        cancelButtonProps={{ autoInsertSpace: false, disabled: cancelDisabled }}
        onOk={onOk}
        onCancel={onCancel}
        destroyOnHidden
        width={640}
      >
        {children}
      </Modal>
    )
  }

  return (
    <Drawer
      placement="bottom"
      open={open}
      onClose={onCancel}
      size="auto"
      closable={false}
      destroyOnHidden
      rootClassName="upload-sheet"
      styles={{ body: { padding: 0 }, section: { borderRadius: '14px 14px 0 0' } }}
    >
      {/* 内容可能比屏幕高(拖拽区 + 候选 + 更新说明):头尾固定,中间滚 */}
      <div className="flex max-h-[90dvh] flex-col font-sans-sc">
        <div className="flex-none pt-2">
          <div className="flex justify-center pb-1" aria-hidden>
            <div className="h-1 w-9 rounded-full bg-edge" />
          </div>
          <div className="flex items-center justify-between border-b border-row-rule pl-5 pr-1.5">
            <span className="font-serif-sc text-[16px] font-semibold text-ink">{title}</span>
            <button
              type="button"
              aria-label="关闭"
              disabled={cancelDisabled}
              onClick={onCancel}
              className="flex size-11 items-center justify-center text-[16px] text-ink-mute disabled:opacity-40"
            >
              <CloseOutlined aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-2">{children}</div>

        <div className="flex flex-none gap-2.5 border-t border-row-rule px-3.5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={cancelDisabled}
            onClick={onCancel}
            className="flex h-[46px] flex-1 items-center justify-center rounded-full bg-aside text-[15px] text-ink-soft disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            disabled={okDisabled}
            onClick={onOk}
            className="flex h-[46px] flex-[2] items-center justify-center rounded-full bg-navy text-[15px] font-medium text-page disabled:opacity-40"
          >
            {okText}
          </button>
        </div>
      </div>
    </Drawer>
  )
}
