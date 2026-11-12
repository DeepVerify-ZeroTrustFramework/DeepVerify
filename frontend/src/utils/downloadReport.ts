/**
 * Download a session's forensic PDF report as a file.
 *
 * fetch() is used rather than a plain link so the request is routed to the API
 * host in production (main.tsx redirects /api fetches to VITE_API_URL), and so the
 * browser saves the file instead of opening a tab. `tz` is the viewer's UTC
 * offset in minutes; the report prints every time in that local time.
 */
export async function downloadReport(sessionId: string): Promise<void> {
  const tz = -new Date().getTimezoneOffset()
  const res = await fetch(`/api/reports/${encodeURIComponent(sessionId)}/pdf?tz=${tz}`)
  if (!res.ok) throw new Error(`Report could not be generated (${res.status})`)
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] || `DeepVerify_Report_${sessionId}.pdf`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface ReportSummary {
  session_id: string
  status: string
  has_data: boolean
  final_score: number | null
  average_score: number | null
  lowest_score: number | null
  breakdown: { prnu: number; rppg: number; jitter: number; behavioral: number }
  alert_count: number
}

/** Final numbers of a finished session (null if unavailable). */
export async function fetchReportSummary(sessionId: string): Promise<ReportSummary | null> {
  try {
    const res = await fetch(`/api/reports/${encodeURIComponent(sessionId)}/summary`)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}
