import { api } from '../api'

/**
 * 研报文件的校验与上传。顶栏「上传研报」按钮(点选)和首页拖拽区共用这一份,
 * 两条入口的校验规则、错误文案、上传接口完全一致。
 */

/** 与服务端 routes/documents.ts 的扩展名白名单一致 */
export const REPORT_ACCEPT = '.md,.markdown,.txt'
const REPORT_EXT_RE = /\.(md|markdown|txt)$/i

/** 与服务端 @fastify/multipart 的 limits.fileSize 一致 */
export const REPORT_MAX_BYTES = 20 * 1024 * 1024

export const REPORT_HINT = '支持 .md / .markdown / .txt,不超过 20 MB'

/** 合法返回 null,否则返回给用户看的错误文案 */
export function validateReportFile(file: File): string | null {
  if (!REPORT_EXT_RE.test(file.name)) return `「${file.name}」格式不支持,只支持 .md / .markdown / .txt 文件`
  if (file.size > REPORT_MAX_BYTES) return `「${file.name}」超过 20 MB,无法上传`
  return null
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
