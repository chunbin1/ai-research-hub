import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { stubMatchMedia } from '../test/matchMedia'
import { useIsMobile } from './useIsMobile'

afterEach(() => { vi.unstubAllGlobals() })

describe('useIsMobile', () => {
  it('桌面视口下为 false', () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('移动视口下为 true', () => {
    stubMatchMedia(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('跨断点时跟随 change 事件翻转', () => {
    const mq = stubMatchMedia(true)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => { mq.setDesktop(false) })
    expect(result.current).toBe(true)

    act(() => { mq.setDesktop(true) })
    expect(result.current).toBe(false)
  })

  it('卸载时解绑监听器', () => {
    const mq = stubMatchMedia(true)
    const { unmount } = renderHook(() => useIsMobile())
    expect(mq.listenerCount).toBe(1)
    unmount()
    expect(mq.listenerCount).toBe(0)
  })
})
