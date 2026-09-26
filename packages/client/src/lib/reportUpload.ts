import { api } from '../api'

/**
 * 研报文件的校验与上传。顶栏「上传研报」按钮的点选 / 拖拽、首页研报行的拖拽、
 * 「上传新版本」弹窗的点选 / 拖拽共用这一份,各入口的校验规则、错误文案完全一致。
 */

/** 与服务端 routes/documents.ts 的扩展名白名单一致 */
export const REPORT_ACCEPT = '.md,.markdown,.txt'
const REPORT_EXT_RE = /\.(md|markdown|txt)$/i

/** 与服务端 @fastify/multipart 的 limits.fileSize 一致 */
export const REPORT_MAX_BYTES = 20 * 1024 * 1024

/** 合法返回 null,否则返回给用户看的错误文案 */
export function validateReportFile(file: File): string | null {
  if (!REPORT_EXT_RE.test(file.name)) return `「${file.name}」格式不支持,只支持 .md / .markdown / .txt 文件`
  if (file.size > REPORT_MAX_BYTES) return `「${file.name}」超过 20 MB,无法上传`
  return null
}

/**
 * 从一次拖拽 / 选择里取出唯一的研报文件。和原来的点选一致只收一个:
 * 拖进多个直接报错、一个都不收(不悄悄只取第一个,免得传错)。
 */
export function pickReportFile(files: File[]): { file: File; error?: undefined } | { file?: undefined; error: string } {
  if (files.length === 0) return { error: '没有拿到文件' }
  if (files.length > 1) return { error: '一次只能上传一个文件' }
  const error = validateReportFile(files[0])
  return error ? { error } : { file: files[0] }
}

export interface ReportUploadCallbacks {
  onUploaded?: () => void
  onUploadError?: (message: string) => void
  onUploadingChange?: (uploading: boolean) => void
}

/** 校验 → 上传新研报。失败只走 onUploadError,不抛 */
export async function uploadReport(file: File, cb: ReportUploadCallbacks): Promise<void> {
  const invalid = validateReportFile(file)
  if (invalid) { cb.onUploadError?.(invalid); return }
  cb.onUploadingChange?.(true)
  try {
    await api.uploadDocument(file)
    cb.onUploaded?.()
  } catch (err) {
    cb.onUploadError?.(err instanceof Error ? err.message : '上传失败')
  } finally {
    cb.onUploadingChange?.(false)
  }
}
