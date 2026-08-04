import { Link } from 'react-router-dom'
import { ArrowLeftOutlined } from '@ant-design/icons'

interface Props {
  to: string
  children: React.ReactNode
  /** 各页返回链接的字号/颜色不同,由调用方传入 */
  className?: string
}

/**
 * 「← 返回」链接。全站 9 处用法完全一致(图标 + 文案 + hover),
 * 是本次迁移里唯一满足「≥3 处重复」封装门槛的组件。
 * 图标是纯装饰 —— 旁边就有文字,读屏不该重复播报。
 */
export function BackLink({ to, children, className }: Props) {
  return (
    <Link to={to} className={className}>
      <ArrowLeftOutlined aria-hidden />
      <span className="ml-1">{children}</span>
    </Link>
  )
}
