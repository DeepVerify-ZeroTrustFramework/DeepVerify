import { useEffect, useRef } from 'react'

/**
 * Live ambient background: slow-drifting maroon / blush light fields plus a faint
 * "signal network" of particles. Cursor gently pulls the light. Purely decorative:
 * fixed behind content, pointer-events disabled, paused when the tab is hidden,
 * static when the user prefers reduced motion.
 */
export default function LiveBackground({ density = 1 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, dpr = 1, raf = 0, running = true
    const mouse = { x: 0.5, y: 0.3, tx: 0.5, ty: 0.3 }

    // Light fields: [r,g,b,alpha, radius(vmax), speed, phase, orbit x, orbit y, base x, base y]
    const blobs = [
      [164, 18, 63, 0.09, 0.55, 0.00011, 0.0, 0.18, 0.12, 0.88, 0.08],
      [205, 200, 208, 0.45, 0.50, 0.00008, 1.7, 0.20, 0.18, 0.10, 0.25],
      [234, 228, 220, 0.70, 0.60, 0.00006, 3.1, 0.22, 0.10, 0.35, 0.95],
      [122, 13, 46, 0.05, 0.45, 0.00009, 4.4, 0.16, 0.20, 0.88, 0.75],
      [255, 255, 255, 0.55, 0.40, 0.00012, 2.3, 0.25, 0.22, 0.55, 0.45],
    ]

    type P = { x: number; y: number; vx: number; vy: number }
    let pts: P[] = []

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = Math.round(Math.min(70, (w * h) / 22000) * density)
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
      }))
    }

    const draw = (t: number) => {
      mouse.x += (mouse.tx - mouse.x) * 0.03
      mouse.y += (mouse.ty - mouse.y) * 0.03
      ctx.clearRect(0, 0, w, h)
      const vmax = Math.max(w, h)

      // Light fields
      ctx.globalCompositeOperation = 'source-over'
      for (const b of blobs) {
        const [r, g, bl, a, rad, sp, ph, ox, oy, bx, by] = b
        const px = (bx + Math.sin(t * sp + ph) * ox + (mouse.x - 0.5) * 0.06) * w
        const py = (by + Math.cos(t * sp * 1.3 + ph) * oy + (mouse.y - 0.5) * 0.06) * h
        const R = rad * vmax
        const grd = ctx.createRadialGradient(px, py, 0, px, py, R)
        grd.addColorStop(0, `rgba(${r},${g},${bl},${a})`)
        grd.addColorStop(1, `rgba(${r},${g},${bl},0)`)
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, w, h)
      }

      // Signal network
      const linkDist = 140
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy
        if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20
        if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20
      }
      ctx.lineWidth = 1
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j]
          const dx = a.x - b.x, dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 < linkDist * linkDist) {
            const o = (1 - Math.sqrt(d2) / linkDist) * 0.07
            ctx.strokeStyle = `rgba(40,32,40,${o})`
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
          }
        }
      }
      for (const p of pts) {
        ctx.fillStyle = 'rgba(40,32,40,0.16)'
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2); ctx.fill()
      }

      // Slow pulse wave (heartbeat line) drifting across the lower third
      const yb = h * 0.78
      ctx.strokeStyle = 'rgba(164,18,63,0.045)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let x = 0; x <= w; x += 6) {
        const ph = x * 0.012 - t * 0.0012
        const beat = Math.exp(-Math.pow(((x - (t * 0.08) % (w + 400)) + 200) / 40, 2)) * 26
        const y = yb + Math.sin(ph) * 8 - beat
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()

      if (running && !reduce) raf = requestAnimationFrame(draw)
    }

    const onMove = (e: PointerEvent) => { mouse.tx = e.clientX / w; mouse.ty = e.clientY / h }
    const onVis = () => {
      running = document.visibilityState === 'visible'
      cancelAnimationFrame(raf)
      if (running && !reduce) raf = requestAnimationFrame(draw)
    }

    resize()
    raf = requestAnimationFrame(draw)
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [density])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none -z-10"
    />
  )
}
