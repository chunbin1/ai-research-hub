import { useRef, useState, type DragEvent } from 'react'

/**
 * 拖拽接收文件。返回 dragging(是否有文件悬停在区域上)和要铺到容器上的事件处理。
 *
 * 高亮不用 dragleave 直接关:指针从容器移到它的子元素上时,浏览器会先对容器发
 * dragleave、再对子元素发 dragenter,直接关会一闪一闪。这里数 enter/leave 的层数,
 * 归零才算真的离开。
 *
 * 四个事件都 preventDefault:dragover 不阻止默认的话 drop 根本不会触发,
 * drop 不阻止的话浏览器会直接打开这个文件、把页面换掉。
 */
export function useFileDrop(onFiles: (files: File[]) => void, disabled = false) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  /** 只响应拖进来的是文件;拖一段选中文字进来不高亮 */
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  const dropProps = {
    onDragEnter(e: DragEvent) {
      e.preventDefault()
      if (disabled || !hasFiles(e)) return
      depth.current += 1
      setDragging(true)
    },
    onDragOver(e: DragEvent) {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    },
    onDragLeave(e: DragEvent) {
      e.preventDefault()
      if (depth.current === 0) return
      depth.current -= 1
      if (depth.current === 0) setDragging(false)
    },
    onDrop(e: DragEvent) {
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      if (disabled) return
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length > 0) onFiles(files)
    },
  }

  return { dragging, dropProps }
}
