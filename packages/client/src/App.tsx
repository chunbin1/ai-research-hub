import { lazy, type ComponentType } from 'react'
import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import { SiteLayout } from './components/SiteLayout'
import { useWindowDropGuard } from './hooks/useFileDrop'

/**
 * 首页之外的路由全部按需加载,并且各自带上 antd。
 *
 * 首页首屏不 import antd / react-markdown。这两块加上 react-dom 曾经占掉主包
 * 的大部分:国内网络下要先下完才能画出列表。现在首页只下 react、路由和页面自己的代码;
 * antd、markdown 各自独立成 chunk,第一次打开阅读页 / 信号页 / 弹层时再取。
 *
 * 路由切换不会闪白:react-router v7 默认用 startTransition 做导航,
 * 旧页面会一直留在屏幕上直到新 chunk 到位。只有**直接打开**某个非首页路由时
 * 才会多一次同源请求,这期间顶栏照常画出、内容区的 fallback 是 null(见 SiteLayout)。
 *
 * 所有页面都挂在 SiteLayout 下,共用同一条顶栏。
 */

function lazyWithAntd(loader: () => Promise<{ default: ComponentType }>) {
  return lazy(async () => {
    const [{ AntdProvider }, mod] = await Promise.all([
      import('./antd/AntdProvider'),
      loader(),
    ])
    const Page = mod.default
    function RoutedPage() {
      return (
        <AntdProvider>
          <Page />
        </AntdProvider>
      )
    }
    return { default: RoutedPage }
  })
}

const ReaderPage = lazyWithAntd(() => import('./pages/ReaderPage'))
const VersionDiffPage = lazyWithAntd(() => import('./pages/VersionDiffPage'))
const SignalsPage = lazyWithAntd(() => import('./pages/SignalsPage'))
// 持仓页不引用 antd,单独懒加载,避免打开它时把 antd 拉下来。
const HoldingsPage = lazy(() => import('./pages/HoldingsPage'))
const WhalesPage = lazy(() => import('./pages/WhalesPage'))
const WhaleDetailPage = lazy(() => import('./pages/WhaleDetailPage'))
const TracesPage = lazyWithAntd(() => import('./components/TracesPage').then(m => ({ default: m.TracesPage })))
const TraceDetailPage = lazyWithAntd(() => import('./components/TraceDetailPage').then(m => ({ default: m.TraceDetailPage })))
const EvalDashboard = lazyWithAntd(() => import('./pages/EvalDashboard'))
const EvalDetailPage = lazyWithAntd(() => import('./pages/EvalDetailPage'))
const SettingsPage = lazyWithAntd(() => import('./pages/SettingsPage'))
const AdminPage = lazyWithAntd(() => import('./pages/AdminPage'))

export default function App() {
  // 文件没拖到拖拽区就松手时,别让浏览器直接打开它、把整页换掉
  useWindowDropGuard()
  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/reports/:id" element={<ReaderPage />} />
        <Route path="/reports/:id/diff" element={<VersionDiffPage />} />
        <Route path="/signals" element={<SignalsPage />} />
        <Route path="/holdings" element={<HoldingsPage />} />
        <Route path="/whales" element={<WhalesPage />} />
        <Route path="/whales/:slug" element={<WhaleDetailPage />} />
        <Route path="/traces" element={<TracesPage />} />
        <Route path="/traces/:id" element={<TraceDetailPage />} />
        <Route path="/eval" element={<EvalDashboard />} />
        <Route path="/eval/:docId" element={<EvalDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
    </Routes>
  )
}
