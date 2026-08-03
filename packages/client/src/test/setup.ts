import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { createElement, type ComponentProps } from 'react'

// @testing-library/react 的自动清理依赖全局 afterEach(vitest.config 未开 globals,
// 不存在 globalThis.afterEach),不显式注册的话多次 render() 会跨用例累积 DOM。
afterEach(() => {
  cleanup()
})

// @ant-design/icons 内部(colorUtils.js)用 require() 直接读 @ant-design/colors 的
// /es/generate 子路径(纯 ESM),在 vitest 的 Node CJS 环境下加载会直接抛
// "Cannot use import statement outside a module"——这是第三方包在 vitest + pnpm 下的已知
// ESM/CJS 互操作问题,与我们的改动无关,试过 server.deps.inline / ssr.noExternal /
// fallbackCJS 均无法绕开(该 require 调用最终仍走 Node 原生 loader)。
// 测试里没有任何断言关心图标的真实渲染内容,这里把用到的图标替身成占位 <span>。
// vitest 要求 mock 工厂显式声明具名导出(Proxy 的动态 get 满足不了它的静态导出检查),
// 新增图标用法时需要在这里补一行。
function iconStub(name: string) {
  return function IconStub(props: ComponentProps<'span'>) {
    return createElement('span', { 'data-icon': name, ...props })
  }
}
vi.mock('@ant-design/icons', () => ({
  ArrowLeftOutlined: iconStub('ArrowLeftOutlined'),
  MenuOutlined: iconStub('MenuOutlined'),
  NodeIndexOutlined: iconStub('NodeIndexOutlined'),
  BarChartOutlined: iconStub('BarChartOutlined'),
  SettingOutlined: iconStub('SettingOutlined'),
  CheckCircleOutlined: iconStub('CheckCircleOutlined'),
}))
