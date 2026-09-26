import { useRef, useState, type KeyboardEvent } from 'react'
import { InboxOutlined } from '@ant-design/icons'
import { useFileDrop } from '../hooks/useFileDrop'
import { REPORT_ACCEPT, REPORT_HINT, pickReportFile } from '../lib/reportUpload'

export const DROP_HINT = '拖拽文件到此处，或点击选择文件'

/**
 * 研报文件的选择区,「上传研报」「上传新版本」两个弹窗共用。铺满弹窗内容区宽度、
 * 留足高度,拖进来或点击弹出文件框,两条路径走同一套校验(pickReportFile)。
 *
 * 只负责「选」:合法的文件交给 onFile,不合法的在区域下方给出错误;
 * 真正提交由弹窗的「上传」按钮做。
 */
export function ReportDropZone({ onFile, selectedName, disabled = false }: {
  onFile: (file: File) => void
  /** 已选中的文件名,显示在区域里 */
  selectedName?: string
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  function accept(files: File[]) {
    if (files.length === 0) return
    const picked = pickReportFile(files)
    if (picked.error !== undefined) { setError(picked.error); return }
    setError('')
    onFile(picked.file)
  }

  const { dragging, dropProps } = useFileDrop(accept, disabled)

  function openPicker() {
    if (!disabled) inputRef.current?.click()
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker() }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={`${DROP_HINT}(${REPORT_HINT})`}
        data-dragging={dragging || undefined}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        {...dropProps}
        className={`flex min-h-[220px] w-full flex-col items-center justify-center gap-2 rounded-[6px] border border-dashed px-6 py-8 text-center transition-[border-color,background] duration-150 ${
          dragging
            ? 'border-navy bg-navy-wash'
            : error
              ? 'border-danger bg-[#FCFBF9]'
              : 'border-navy-edge bg-[#FCFBF9] hover:border-navy hover:bg-navy-wash'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      >
        <InboxOutlined aria-hidden className="text-[40px] text-navy" />
        <span className="text-[15px] text-ink">{dragging ? '松开即可选择这个文件' : DROP_HINT}</span>
        <span className="text-[12px] text-ink-faint">{REPORT_HINT}</span>
        {selectedName && (
          <span className="mt-2 max-w-full truncate rounded-[3px] bg-[#E4EAF0] px-2.5 py-1 text-[13px] text-navy">
            已选择:{selectedName}
          </span>
        )}
      </div>
      {/* 放在可点区域外面:input.click() 冒泡回父元素会再触发一次 openPicker */}
      <input
        ref={inputRef}
        type="file"
        accept={REPORT_ACCEPT}
        hidden
        data-testid="report-file-input"
        onChange={e => { accept(Array.from(e.target.files ?? [])); e.target.value = '' }}
      />
      {error && <p role="alert" className="m-0 mt-2 text-[13px] text-danger">{error}</p>}
    </div>
  )
}
