import { useLocation } from 'react-router-dom'
import LiveBackground from './LiveBackground'
import AmbientBackground from './AmbientBackground'

/* Pages that capture the candidate's camera get the compositor-only background,
   so nothing competes with frame timing on the main thread. */
const CAPTURE = [/^\/demo/, /^\/check\//, /^\/session\//, /^\/dashboard\//]

/* Pages already converted to the glass design (others keep their own backgrounds
   until they are redesigned, so no background runs hidden behind them). */
const GLASS = [/^\/$/, /^\/demo/, /^\/auth\//, /^\/recruiter/, /^\/student/, /^\/dashboard\//, /^\/check\//]

/** One app-wide live background, mounted once behind every glass page. */
export default function AppBackground() {
  const { pathname } = useLocation()
  if (!GLASS.some(r => r.test(pathname))) return null
  return CAPTURE.some(r => r.test(pathname)) ? <AmbientBackground /> : <LiveBackground />
}
