import { Drawer } from 'antd'
import { DeleteOutlined, SwapOutlined, UploadOutlined } from '@ant-design/icons'
import { AntdProvider } from '../antd/AntdProvider'
import { docKind, type Document } from '../types'

/**
 * 首页移动端行操作菜单。单独成块是为了按需加载 antd Drawer,
 * 未登录 / 不点「⋯」时首页不必下载它。
 */
export function HomeRowMenu({ doc, onClose, onUpload, onToggleKind, onDelete }: {
  doc: Document
  onClose: () => void
  onUpload: () => void
  onToggleKind: () => void
  onDelete: () => void
}) {
  return (
    <AntdProvider>
      <Drawer
        placement="bottom"
        open
        onClose={onClose}
        size="auto"
        closable={false}
        rootClassName="home-row-menu"
        styles={{ body: { padding: 0 }, section: { borderRadius: '14px 14px 0 0' } }}
      >
        <div className="flex flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 font-sans-sc">
          <div className="flex justify-center pb-2" aria-hidden>
            <div className="h-1 w-9 rounded-full bg-edge" />
          </div>
          <span className="border-b border-row-rule px-5 pb-3.5 pt-1.5 font-serif-sc text-[15px] font-semibold leading-[1.5] text-ink">
            {doc.filename}
          </span>
          <button
            type="button"
            onClick={onUpload}
            className="flex h-[52px] items-center gap-3 border-b border-row-rule px-5 text-left text-[15px] text-navy"
          >
            <UploadOutlined aria-hidden className="text-[18px]" />
            上传新版本
          </button>
          <button
            type="button"
            onClick={onToggleKind}
            className="flex h-[52px] items-center gap-3 border-b border-row-rule px-5 text-left text-[15px] text-navy"
          >
            <SwapOutlined aria-hidden className="text-[18px]" />
            {docKind(doc) === 'company' ? '改为行业研报' : '改为公司研报'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex h-[52px] items-center gap-3 px-5 text-left text-[15px] text-brick"
          >
            <DeleteOutlined aria-hidden className="text-[18px]" />
            删除
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mx-3.5 mt-2 flex h-[46px] items-center justify-center rounded-full bg-aside text-[15px] text-ink-soft"
          >
            取消
          </button>
        </div>
      </Drawer>
    </AntdProvider>
  )
}
