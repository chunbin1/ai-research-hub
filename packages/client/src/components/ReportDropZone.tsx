import { useRef, useState, type KeyboardEvent } from 'react'
import { UploadOutlined } from '@ant-design/icons'
import { useFileDrop } from '../hooks/useFileDrop'
import { REPORT_ACCEPT, REPORT_HINT, validateReportFile } from '../lib/reportUpload'

export const DROP_HINT = '拖拽文件到此处，或点击选择'

/**
 * 研报文件的选择区:拖拽进来或点击弹出文件框,两条路径走同一套校验。
 * 只收一个文件(与原来的点选上传一致),一次拖进多个直接报错、一个都不收。
 * 不合法的文件在区域下方给出错误,合法的交给 onFile —— 上传还是暂存由调用方决定。
 */
export function ReportDropZone({ onFile, disabled = false, label = DROP_HINT, selectedName, className = '' }: {
  onFile: (file: File) => void
  disabled?: boolean
  /** 主提示文字;上传中可换成「上传中…」 */
  label?: string
  /** 已选中的文件名(暂存型调用方用,如上传新版本弹窗) */
  selectedName?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  function accept(files: File[]) {
    if (files.length === 0) return
    if (files.length > 1) { setError('一次只能上传一个文件'); return }
    const invalid = validateReportFile(files[0])
    if (invalid) { setError(invalid); return }
    setError('')
    onFile(files[0])
  }

  const { dragging, dropProps } = useFileDrop(accept, disabled)

  function openPicker() {
    if (!disabled) inputRef.current?.click()
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker() }
  }

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={`${label}(${REPORT_HINT})`}
        data-dragging={dragging || undefined}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        {...dropProps}
        className={`flex flex-col items-center justify-center gap-1 rounded-[4px] border border-dashed px-4 py-4 text-center transition-[border-color,background] duration-150 ${
          dragging
            ? 'border-navy bg-navy-wash'
            : error
              ? 'border-danger bg-white'
              : 'border-navy-edge bg-white hover:border-navy hover:bg-navy-wash'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      >
        <span className="flex items-center gap-2 text-[13px] text-navy">
          <UploadOutlined aria-hidden className="text-[14px]" />
          {dragging ? '松开即可上传' : label}
        </span>
        <span className="text-[12px] text-ink-faint">{REPORT_HINT}</span>
        {selectedName && <span className="mt-1 text-[13px] text-ink">已选择:{selectedName}</span>}
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
