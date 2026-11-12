import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, LogOut } from 'lucide-react'
import Avatar from './Avatar'

export type NavItem<K extends string> = { key: K; label: string; icon: React.ElementType; badge?: number | string }

/**
 * Dashboard shell: liquid-glass side navigation with a sliding active pill
 * (bottom tab bar on small screens), a page header and the content area.
 * Purely presentational — the page owns all state and actions.
 */
export default function DashShell<K extends string>({
  consoleName, items, active, onSelect, userName, userSub, userPhoto, onSignOut,
  title, subtitle, actions, children,
}: {
  consoleName: string
  items: NavItem<K>[]
  active: K
  onSelect: (k: K) => void
  userName: string
  userSub?: string | null
  userPhoto?: string | null
  onSignOut: () => void
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen relative">
      {/* ── Side nav (desktop) ── */}
      <aside className="hidden lg:flex fixed left-5 top-5 bottom-5 w-[264px] z-40 flex-col rounded-[28px] glass-strong liquid p-4">
        <Link to="/" className="flex items-center gap-3 px-2 pt-1 pb-5">
          <div className="glass-tile-maroon !w-11 !h-11 !rounded-[13px]"><ShieldCheck size={20} className="text-white" /></div>
          <div>
            <p className="text-[16px] font-bold text-[#141114] leading-tight tracking-[-0.015em]">DeepVerify</p>
            <p className="text-[10.5px] font-semibold text-[#85818A] leading-tight mt-0.5 uppercase tracking-[0.12em]">{consoleName}</p>
          </div>
        </Link>

        <p className="glass-label !text-[10px] px-3 mb-2">Workspace</p>
        <SideItems items={items} active={active} onSelect={onSelect} />

        <div className="mt-auto pt-4">
          <div className="flex items-center gap-3 p-3 rounded-[20px] glass-soft">
            <Avatar src={userPhoto} name={userName} size={40} rounded={12} />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-[#141114] truncate">{userName}</p>
              {userSub && <p className="text-[11.5px] text-[#85818A] truncate">{userSub}</p>}
            </div>
            <button onClick={onSignOut} title="Sign out" className="glass-icon-btn !w-9 !h-9 !rounded-[11px] shrink-0">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Bottom tab bar (mobile / tablet) ── */}
      <nav className="lg:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-[26px] glass-strong liquid p-1.5 flex items-center gap-1">
        {items.map(it => (
          <button key={it.key} onClick={() => onSelect(it.key)}
            className={`relative flex flex-col items-center gap-1 px-4 py-2 rounded-[20px] text-[10.5px] font-semibold transition-all ${active === it.key ? 'bg-white/90 text-[#A4123F] shadow-[inset_0_1px_0_#fff,0_6px_16px_-8px_rgba(20,14,18,0.35)]' : 'text-[#67636C]'}`}>
            <it.icon size={18} />
            {it.label}
          </button>
        ))}
      </nav>

      {/* ── Main ── */}
      <div className="lg:pl-[300px]">
        <header className="max-w-[1320px] mx-auto px-6 lg:pr-8 pt-8 lg:pt-10 pb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 w-full lg:w-auto">
            <div className="lg:hidden flex items-center gap-2.5 mb-5">
              <div className="glass-tile-maroon !w-9 !h-9 !rounded-[11px]"><ShieldCheck size={17} className="text-white" /></div>
              <span className="text-[15px] font-bold text-[#141114]">DeepVerify</span>
              <button onClick={onSignOut} className="ml-auto nav-ghost"><LogOut size={15} /> Sign out</button>
            </div>
            <h1 className="text-[clamp(28px,2.6vw,38px)] font-bold text-[#141114] tracking-[-0.035em] leading-tight">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[15px] text-[#67636C]">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2.5 flex-wrap">{actions}</div>}
        </header>
        <main className="max-w-[1320px] mx-auto px-6 lg:pr-8 pb-28 lg:pb-12">
          {children}
        </main>
      </div>
    </div>
  )
}

function SideItems<K extends string>({ items, active, onSelect }: { items: NavItem<K>[]; active: K; onSelect: (k: K) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [ind, setInd] = useState<{ top: number; height: number; ready: boolean }>({ top: 0, height: 0, ready: false })
  const indRef = useRef<HTMLSpanElement>(null)
  const prevTop = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = refs.current[active], w = wrap.current
    if (!el || !w) return
    const top = el.offsetTop, height = el.offsetHeight
    if (prevTop.current !== null && prevTop.current !== top && indRef.current?.animate) {
      indRef.current.animate(
        [{ scale: '1 1' }, { scale: '0.94 1.12', offset: 0.4 }, { scale: '1.02 0.97', offset: 0.75 }, { scale: '1 1' }],
        { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' },
      )
    }
    prevTop.current = top
    setInd(s => ({ top, height, ready: s.ready || true }))
  }, [active, items.length])

  return (
    <div ref={wrap} className="relative flex flex-col gap-1">
      <span ref={indRef} aria-hidden="true"
        className="absolute left-0 right-0 rounded-[16px] pointer-events-none bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,255,255,0.78))] shadow-[inset_0_1px_0_#fff,0_0_0_0.5px_rgba(20,14,18,0.08),0_8px_20px_-8px_rgba(20,14,18,0.32)]"
        style={{ transform: `translateY(${ind.top}px)`, height: ind.height, opacity: ind.ready ? 1 : 0,
          transition: 'transform .55s cubic-bezier(.34,1.36,.64,1), height .4s ease, opacity .2s' }} />
      {items.map(it => {
        const on = it.key === active
        return (
          <button key={it.key} ref={el => { refs.current[it.key] = el }} onClick={() => onSelect(it.key)}
            className={`relative z-[1] flex items-center gap-3 px-3 py-2.5 rounded-[16px] text-[14px] font-semibold transition-colors ${on ? 'text-[#141114]' : 'text-[#67636C] hover:text-[#141114] hover:bg-white/35'}`}>
            <span className={`inline-flex items-center justify-center w-9 h-9 rounded-[11px] transition-all ${on ? 'bg-gradient-to-b from-[#B01848] to-[#7E0D31] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_14px_-6px_rgba(164,18,63,0.7)]' : 'bg-white/50 text-[#67636C] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]'}`}>
              <it.icon size={17} />
            </span>
            <span className="flex-1 text-left">{it.label}</span>
            {it.badge !== undefined && it.badge !== 0 && (
              <span className={`min-w-[22px] px-1.5 h-[22px] inline-flex items-center justify-center rounded-full text-[11px] font-bold ${on ? 'bg-[#A4123F] text-white' : 'bg-[#141114]/[0.06] text-[#55515A]'}`}>{it.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
