import { Suspense } from 'react'
import { Outlet, useMatch } from 'react-router-dom'
import { SiteHeader } from './SiteHeader'

/**
 * 全站外壳:顶栏只挂这一份,各页面只渲染自己的内容(<Outlet />)。
 *
 * 以前每个页面各挂一个 <SiteHeader>,切栏目时顶栏整个卸载再重建,而且首页把它
 * 放在全宽、信号页放在 max-w-[1440px] 容器里 —— 宽屏上切一下 logo 和栏目横移
 * 两百多像素,看起来就是一闪。评估 / 站点模型 / trace 干脆没有顶栏,点进去栏目就没了。
 * 挂在布局路由上之后,切栏目只换下面的内容,顶栏不动。
 *
 * Suspense 放在 Outlet 外面:直接打开某个懒加载页面时,顶栏先画出来,只有内容区等 chunk。
 *
 * 阅读页是例外的外形:整页 h-dvh 不滚、正文区自己滚,移动端有自己的「返回 + 标题 + 目录」
 * 顶栏,所以这里把外壳锁成视口高,并且移动端不出全站顶栏。
 *
 * `*:w-full`:外壳是 flex 纵列,子项一旦带 mx-auto,auto 外边距会让它不再拉伸、
 * 缩成内容宽 —— trace / 评估 / 站点模型这些页面的 `mx-auto max-w-[…]` 容器
 * 会从 1100 缩到五百多。统一给直接子项撑满宽度,max-w + mx-auto 照常居中。
 */
export function SiteLayout() {
  const inReader = useMatch('/reports/:id') !== null

  return (
    <div className={`flex flex-col bg-page font-sans-sc text-ink *:w-full ${inReader ? 'h-dvh' : 'min-h-screen'}`}>
      <div className={`flex-none ${inReader ? 'hidden md:block' : ''}`}>
        <SiteHeader />
      </div>
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </div>
  )
}
