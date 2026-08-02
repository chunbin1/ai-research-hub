import { vi } from 'vitest'

interface MatchMediaStub {
  /** 切换到桌面(true)/移动(false),并派发 change 事件 */
  setDesktop(isDesktop: boolean): void
  /** 当前注册的监听器数量,用来验证卸载时解绑 */
  readonly listenerCount: number
}

/**
 * 用可控的桩替换全局 matchMedia。
 * @param initialDesktopMatches true = 初始为桌面(min-width:768px 命中)
 */
export function stubMatchMedia(initialDesktopMatches: boolean): MatchMediaStub {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  let matches = initialDesktopMatches

  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() { return matches },
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => { listeners.add(cb) },
    removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => { listeners.delete(cb) },
  }))

  return {
    setDesktop(isDesktop: boolean) {
      matches = isDesktop
      listeners.forEach(cb => cb({ matches: isDesktop } as MediaQueryListEvent))
    },
    get listenerCount() { return listeners.size },
  }
}
