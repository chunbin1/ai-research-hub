import { Link } from 'react-router-dom'
import { LeftOutlined } from '@ant-design/icons'

interface Props {
  to: string
  children: React.ReactNode
  /** 各页返回链接的字号/颜色不同,由调用方传入 */
  className?: string
}

/**
 * 返回链接。图标固定 text-[11px],与阅读页工具栏回退像素一致
 * (顶栏回退是更大的点击区,尺寸不同)。
 * 图标是纯装饰 —— 旁边就有文字,读屏不该重复播报。
 */
export function BackLink({ to, children, className }: Props) {
  return (
    <Link to={to} className={className}>
      <LeftOutlined aria-hidden className="text-[11px]" />
      <span className="ml-1">{children}</span>
    </Link>
  )
}
