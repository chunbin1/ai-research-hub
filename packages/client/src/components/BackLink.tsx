import { Link } from 'react-router-dom'
import { LeftOutlined } from '@ant-design/icons'

interface Props {
  to: string
  children: React.ReactNode
  /** 各页返回链接的字号/颜色不同,由调用方传入 */
  className?: string
}

/**
 * 返回链接。图标与阅读页顶栏、工具栏的回退相同。
 * 图标是纯装饰 —— 旁边就有文字,读屏不该重复播报。
 */
export function BackLink({ to, children, className }: Props) {
  return (
    <Link to={to} className={className}>
      <LeftOutlined aria-hidden className="text-[0.85em]" />
      <span className="ml-1">{children}</span>
    </Link>
  )
}
