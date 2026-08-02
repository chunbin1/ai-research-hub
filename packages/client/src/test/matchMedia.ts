import { vi } from 'vitest'

interface MatchMediaStub {
  /** 切换到桌面(true)/移动(false),并派发 change 事件 */
  setDesktop(isDesktop: boolean): void
  /** 当前注册的监听器数量,用来验证卸载时解绑 */
  readonly listenerCount: number
}

const EXPECTED_QUERY = '(min-width: 768px)'

/**
 * 用可控的桩替换全局 matchMedia。
 * @param initialDesktopMatches true = 初始为桌面(min-width:768px 命中)
 */
export function stubMatchMedia(initialDesktopMatches: boolean): MatchMediaStub {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  let matches = initialDesktopMatches

  vi.stubGlobal('matchMedia', (media: string) => {
    // 768px 是全站唯一断点(md),也是 useIsMobile 判定桌面/移动的唯一依据。
    // 桩如果对 media 来者不拒,useIsMobile 传错断点字符串测试也照样全绿——
    // 这里显式校验,任何偏离都会让调用方立刻炸掉而不是安静地测错东西。
    if (media !== EXPECTED_QUERY) {
      throw new Error(`stubMatchMedia: 收到意外的媒体查询 "${media}",期望 "${EXPECTED_QUERY}"`)
    }
    return {
      media,
      get matches() { return matches },
      addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => { listeners.add(cb) },
      removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => { listeners.delete(cb) },
    }
  })

  return {
    setDesktop(isDesktop: boolean) {
      matches = isDesktop
      listeners.forEach(cb => cb({ matches: isDesktop } as MediaQueryListEvent))
    },
    get listenerCount() { return listeners.size },
  }
}
