/**
 * SuperTrend 方向徽章。红涨绿跌:多 = 红、空 = 绿(改版前是「空红多绿」,
 * 同一个红既表示空头又表示下跌,见 design_handoff_homepage/README.md 变更 2)。
 * 无圆角、无小圆点 —— 与页面其他方框保持同一套语言。
 */
export function DirectionBadge({
  trend, label, className = '',
}: { trend: 1 | -1; label: string; className?: string }) {
  const long = trend === 1
  return (
    <span
      className={`w-fit whitespace-nowrap border px-[9px] py-0.5 font-medium ${
        long ? 'border-long-edge bg-long-wash text-long' : 'border-short-edge bg-short-wash text-short'
      } ${className}`}
    >
      {label}
    </span>
  )
}
