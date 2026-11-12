import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { ShieldCheck, User, Building2, LogOut, Film } from 'lucide-react'
import { getAuthUser, clearAuth } from '../utils/auth'

/* Last indicator position survives route changes, so the highlight glides
   from the previous tab to the new one when the next page mounts. */
let lastIndicator: { left: number; width: number } | null = null

type Seg = { to: string; label: string; icon: React.ElementType; match: (p: string) => boolean; accent?: boolean }

function SegmentedNav({ items }: { items: Seg[] }) {
  const { pathname } = useLocation()
  const trackRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const activeIdx = items.findIndex(i => i.match(pathname))
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [pressIdx, setPressIdx] = useState<number | null>(null)
  const [ind, setInd] = useState<{ left: number; width: number; show: boolean; animate: boolean }>(
    () => lastIndicator ? { ...lastIndicator, show: true, animate: false } : { left: 0, width: 0, show: false, animate: false })
  const indRef = useRef<HTMLSpanElement>(null)
  const shownRef = useRef(!!lastIndicator)
  const leftRef = useRef(lastIndicator?.left ?? 0)

  const targetIdx = pressIdx ?? hoverIdx ?? (activeIdx >= 0 ? activeIdx : null)

  useLayoutEffect(() => {
    const track = trackRef.current
    const measure = () => {
      if (targetIdx === null || !track) {
        setInd(s => ({ ...s, show: false, animate: true }))
        shownRef.current = false
        return
      }
      const el = itemRefs.current[targetIdx]
      if (!el) return
      const t = track.getBoundingClientRect(), r = el.getBoundingClientRect()
      const next = { left: r.left - t.left, width: r.width }
      const moved = shownRef.current && Math.abs(leftRef.current - next.left) > 1
      setInd({ ...next, show: true, animate: shownRef.current })
      // iOS-style liquid stretch while the pill travels
      if (moved && indRef.current?.animate) {
        indRef.current.animate(
          [{ scale: '1 1' }, { scale: '1.16 0.86', offset: 0.35 }, { scale: '0.97 1.04', offset: 0.7 }, { scale: '1 1' }],
          { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' },
        )
      }
      shownRef.current = true
      leftRef.current = next.left
      lastIndicator = next
    }
    // next frame so a restored position can paint before it glides
    const id = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', measure) }
  }, [targetIdx, items.length])

  return (
    <div
      ref={trackRef}
      className="seg-track"
      onPointerLeave={() => { setHoverIdx(null); setPressIdx(null) }}
    >
      <span
        ref={indRef}
        aria-hidden="true"
        className={`seg-indicator ${ind.animate ? 'is-animated' : ''}`}
        style={{ transform: `translateX(${ind.left}px)`, width: ind.width, opacity: ind.show ? 1 : 0 }}
      />
      {items.map((it, i) => (
        <Link
          key={it.to}
          to={it.to}
          ref={el => { itemRefs.current[i] = el }}
          title={it.label}
          aria-label={it.label}
          aria-current={i === activeIdx ? 'page' : undefined}
          onPointerEnter={() => setHoverIdx(i)}
          onPointerDown={() => setPressIdx(i)}
          onPointerUp={() => setPressIdx(null)}
          className={`seg-item ${i === targetIdx ? 'is-on' : ''} ${it.accent ? 'is-accent' : ''}`}
        >
          <it.icon size={15} />
          <span className="hidden md:inline">{it.label}</span>
        </Link>
      ))}
    </div>
  )
}

export default function Navbar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const user = getAuthUser()

  const handleLogout = () => {
    clearAuth()
    navigate('/')
  }

  const portalItems: Seg[] = user
    ? user.role === 'candidate'
      ? [{ to: '/student/inbox', label: 'Candidate Inbox', icon: User, match: p => p.startsWith('/student') }]
      : [{ to: '/recruiter/dashboard', label: 'Company Dashboard', icon: Building2, match: p => p.startsWith('/recruiter') }]
    : [
        { to: '/auth/candidate/login', label: 'Candidate Portal', icon: User, match: p => p.startsWith('/auth/candidate') },
        { to: '/auth/recruiter/login', label: 'Company Portal', icon: Building2, match: p => p.startsWith('/auth/recruiter'), accent: true },
      ]

  return (
    <nav className="fixed top-5 left-1/2 -translate-x-1/2 w-[92%] max-w-[1120px] z-50 rounded-[24px] glass liquid">
      <div className="pl-3 pr-2.5 h-[4.25rem] flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 pl-1">
          <div className="glass-tile-maroon !w-10 !h-10 !rounded-[12px]">
            <ShieldCheck size={19} className="text-white" />
          </div>
          <div className="flex flex-col justify-center">
            <p className="text-[15px] font-bold text-[#141114] leading-tight tracking-[-0.01em]">DeepVerify</p>
            <p className="hidden sm:block text-[10.5px] font-semibold text-[#85818A] leading-tight mt-0.5 uppercase tracking-[0.12em]">Zero-Trust Interview Integrity</p>
          </div>
        </Link>

        {/* Right side navigation */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link
            to="/demo"
            title="Demo Mode"
            aria-label="Demo Mode"
            className={`nav-ghost ${pathname.startsWith('/demo') ? 'is-active' : ''}`}
          >
            <Film size={15} /> <span className="hidden md:inline">Demo Mode</span>
          </Link>

          <span className="hidden sm:block w-px h-6 bg-[#141114]/10" aria-hidden="true" />

          <SegmentedNav items={portalItems} />

          {user && (
            <button
              onClick={handleLogout}
              className="glass-icon-btn"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}
