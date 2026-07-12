import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ReaderPage from './pages/ReaderPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/reports/:id" element={<ReaderPage />} />
    </Routes>
  )
}
