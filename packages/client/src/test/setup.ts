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
// 测试里没有任何断言关心图标的真实渲染内容,这里用 Proxy 把整个模块替身成占位 <span>,
// 命名导入是运行时对模块命名空间对象的属性访问,会正常落到 get 陷阱上,新增图标不需要
// 再改这个文件——这一点已用「渲染一个不在旧白名单里的图标」实测验证过。
// 踩过的坑:get 陷阱不能对 'then' 也返回一个函数。vitest 的 mock 解析逻辑会用
// `typeof exports.then === 'function'` 鸭子类型判断工厂返回值是不是 thenable,
// 一旦命中就会 `exports.then(resolve, reject)`,把 resolve 回调当 props 传给
// IconStub 调用,"resolve" 出来的是一个 <span> 的 React element 对象(键是
// $$typeof/type/props/...),而不是图标模块——之后任何具名导入访问都会报
// "No "X" export is defined on the "@ant-design/icons" mock"。所以 'then' 必须
// 显式返回 undefined,和 __esModule 一样特殊处理。
vi.mock('@ant-design/icons', () => new Proxy(
  {},
  {
    get(_target, name: string | symbol) {
      if (name === '__esModule') return true
      if (name === 'then') return undefined
      if (typeof name !== 'string') return undefined
      return function IconStub(props: ComponentProps<'span'>) {
        return createElement('span', { 'data-icon': name, ...props })
      }
    },
    has() {
      return true
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true }
    },
  },
))
