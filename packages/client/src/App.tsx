import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'

/**
 * 首页之外的路由全部按需加载。
 *
 * 之前整站打成一个 1.36MB(gzip 432KB)的 chunk:进首页也要先下完、解析完
 * react-markdown / 信号页 / 评估页 / trace 页才画得出第一屏 —— 白屏久,
 * 内容「砰」一下出现。拆开后首页的初始 JS 是 660KB(gzip 216KB),砍掉一半。
 *
 * 路由切换不会闪白:react-router v7 默认用 startTransition 做导航,
 * 旧页面会一直留在屏幕上直到新 chunk 到位。只有**直接打开**某个非首页路由时
 * 才会多一次同源请求,这期间 fallback 是 null —— body 已经有纸感底色,
 * 看到的是底色而不是白屏。
 */

const ReaderPage = lazy(() => import('./pages/ReaderPage'))
const SignalsPage = lazy(() => import('./pages/SignalsPage'))
const TracesPage = lazy(() => import('./components/TracesPage').then(m => ({ default: m.TracesPage })))
const TraceDetailPage = lazy(() => import('./components/TraceDetailPage').then(m => ({ default: m.TraceDetailPage })))
const EvalDashboard = lazy(() => import('./pages/EvalDashboard'))
const EvalDetailPage = lazy(() => import('./pages/EvalDetailPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/reports/:id" element={<ReaderPage />} />
        <Route path="/signals" element={<SignalsPage />} />
        <Route path="/traces" element={<TracesPage />} />
        <Route path="/traces/:id" element={<TraceDetailPage />} />
        <Route path="/eval" element={<EvalDashboard />} />
        <Route path="/eval/:docId" element={<EvalDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </Suspense>
  )
}
