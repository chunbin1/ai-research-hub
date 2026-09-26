import { useEffect, useRef, useState, type DragEvent } from 'react'

/**
 * 拖拽接收文件。返回 dragging(是否有文件悬停在区域上)和要铺到容器上的事件处理。
 *
 * 高亮不用 dragleave 直接关:指针从容器移到它的子元素上时,浏览器会先对容器发
 * dragleave、再对子元素发 dragenter,直接关会一闪一闪。这里数 enter/leave 的层数,
 * 归零才算真的离开。
 *
 * 四个事件都 preventDefault:dragover 不阻止默认的话 drop 根本不会触发,
 * drop 不阻止的话浏览器会直接打开这个文件、把页面换掉。
 * drop 在捕获阶段处理并 stopPropagation:文件归这个区域处理,里外层别的拖拽处理
 * (比如 antd Upload 自带的 onDrop,它只按 accept 静默过滤、不报错、多个文件照收)
 * 不该再收一次。
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
    onDropCapture(e: DragEvent) {
      e.preventDefault()
      e.stopPropagation()
      depth.current = 0
      setDragging(false)
      if (disabled) return
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length > 0) onFiles(files)
    },
  }

  return { dragging, dropProps }
}

/**
 * 页面上是否正有文件被拖着(还没松手)。用来在拖拽开始时把可放置的入口提示出来,
 * 让人知道往哪儿拖。同样按层数计数防闪。
 *
 * 监听挂在 window 的捕获阶段:目标区域的 drop 会 stopPropagation,冒泡阶段收不到。
 * 顺带在 window 上 preventDefault dragover / drop:没对准入口松手时,浏览器不会
 * 直接打开这个文件、把整页换掉。
 */
export function useWindowFileDrag(enabled = true) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!enabled) { setActive(false); return }
    let depth = 0
    const isFiles = (e: globalThis.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: globalThis.DragEvent) => {
      if (!isFiles(e)) return
      depth += 1
      setActive(true)
    }
    const onLeave = (e: globalThis.DragEvent) => {
      if (!isFiles(e) || depth === 0) return
      depth -= 1
      if (depth === 0) setActive(false)
    }
    const onEnd = () => { depth = 0; setActive(false) }
    const onOver = (e: globalThis.DragEvent) => { if (isFiles(e)) e.preventDefault() }
    const onDropBubble = (e: globalThis.DragEvent) => { if (isFiles(e)) e.preventDefault() }
    window.addEventListener('dragenter', onEnter, true)
    window.addEventListener('dragleave', onLeave, true)
    window.addEventListener('drop', onEnd, true)
    window.addEventListener('dragend', onEnd, true)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDropBubble)
    return () => {
      window.removeEventListener('dragenter', onEnter, true)
      window.removeEventListener('dragleave', onLeave, true)
      window.removeEventListener('drop', onEnd, true)
      window.removeEventListener('dragend', onEnd, true)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDropBubble)
    }
  }, [enabled])

  return active
}
