import { useEffect, useState } from 'react'

/** 全站唯一断点,与 Tailwind 默认的 md 保持一致。 */
const DESKTOP_QUERY = '(min-width: 768px)'

/**
 * 视口是否窄于 768px。
 * 只用于**行为**差异(面板初值 / 点来源是否收面板 / 是否锁 body 滚动);
 * 纯布局差异一律交给 Tailwind 的 md: 前缀,不要用这个 hook 去条件渲染布局。
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => !window.matchMedia(DESKTOP_QUERY).matches)

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY)
    const onChange = (e: MediaQueryListEvent): void => { setIsMobile(!e.matches) }
    mql.addEventListener('change', onChange)
    // 挂载与首次渲染之间视口可能已变化,补一次同步
    setIsMobile(!mql.matches)
    return () => { mql.removeEventListener('change', onChange) }
  }, [])

  return isMobile
}
