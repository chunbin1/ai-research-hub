import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ReaderPage from './pages/ReaderPage'
import { TracesPage } from './components/TracesPage'
import { TraceDetailPage } from './components/TraceDetailPage'
import EvalDashboard from './pages/EvalDashboard'
import EvalDetailPage from './pages/EvalDetailPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/reports/:id" element={<ReaderPage />} />
      <Route path="/traces" element={<TracesPage />} />
      <Route path="/traces/:id" element={<TraceDetailPage />} />
      <Route path="/eval" element={<EvalDashboard />} />
      <Route path="/eval/:docId" element={<EvalDetailPage />} />
    </Routes>
  )
}
