import type { ReactNode } from 'react'
import { StyleProvider } from '@ant-design/cssinjs'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'

/**
 * antd 的主题、中文文案和样式层。
 *
 * 不放在 main.tsx:ConfigProvider 会把 antd 运行时拉进首页首屏包。
 * 只有真正画出 antd 组件的路由 / 弹层才加载这一份。
 * layer 把 antd 样式注入 @layer antd(见 index.css 首行),
 * 让 preflight 盖不住 antd,而 Tailwind utility 仍能盖过 antd。
 */
export function AntdProvider({ children }: { children: ReactNode }) {
  return (
    <StyleProvider layer>
      <ConfigProvider locale={zhCN}>{children}</ConfigProvider>
    </StyleProvider>
  )
}
