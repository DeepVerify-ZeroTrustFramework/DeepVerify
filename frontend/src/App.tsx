import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing'
import CreateSession from './pages/CreateSession'
import SystemCheck from './pages/SystemCheck'
import CandidateSession from './pages/CandidateSession'
import InterviewerDash from './pages/InterviewerDash'
import NotFound from './pages/NotFound'
import './index.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/create" element={<CreateSession />} />
        <Route path="/check/:token" element={<SystemCheck />} />
        <Route path="/session/:token" element={<CandidateSession />} />
        <Route path="/dashboard/:sessionId" element={<InterviewerDash />} />
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
