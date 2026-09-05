import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing'
import CreateSession from './pages/CreateSession'
import SystemCheck from './pages/SystemCheck'
import CandidateSession from './pages/CandidateSession'
import InterviewerDash from './pages/InterviewerDash'
import NotFound from './pages/NotFound'

// Role-based auth & portal pages
import CandidateLogin from './pages/auth/CandidateLogin'
import CandidateSignup from './pages/auth/CandidateSignup'
import RecruiterLogin from './pages/auth/RecruiterLogin'
import RecruiterSignup from './pages/auth/RecruiterSignup'
import StudentInbox from './pages/student/StudentInbox'
import RecruiterDashboard from './pages/recruiter/RecruiterDashboard'

import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Public & Landing */}
          <Route path="/" element={<Landing />} />
          <Route path="/create" element={<CreateSession />} />

          {/* Candidate Auth & Portal */}
          <Route path="/auth/candidate/login" element={<CandidateLogin />} />
          <Route path="/auth/candidate/signup" element={<CandidateSignup />} />
          <Route path="/student/inbox" element={<StudentInbox />} />
          <Route path="/candidate/inbox" element={<Navigate to="/student/inbox" replace />} />

          {/* Recruiter Auth & Portal */}
          <Route path="/auth/recruiter/login" element={<RecruiterLogin />} />
          <Route path="/auth/recruiter/signup" element={<RecruiterSignup />} />
          <Route path="/recruiter/dashboard" element={<RecruiterDashboard />} />

          {/* Active Interview & Forensic Routes */}
          <Route path="/check/:token" element={<SystemCheck />} />
          <Route path="/session/:token" element={<CandidateSession />} />
          <Route path="/dashboard/:sessionId" element={<InterviewerDash />} />

          {/* Fallbacks */}
          <Route path="/404" element={<NotFound />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
