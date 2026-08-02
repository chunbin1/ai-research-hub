import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// @testing-library/react 的自动清理依赖全局 afterEach(vitest.config 未开 globals,
// 不存在 globalThis.afterEach),不显式注册的话多次 render() 会跨用例累积 DOM。
afterEach(() => {
  cleanup()
})
