import { useMemo } from 'react'

/**
 * Compositor-only live background for camera-capture pages (demo, system check,
 * candidate session). Same look as LiveBackground — drifting light fields and a
 * faint signal network — but animated purely with CSS transforms, so it does no
 * per-frame JavaScript on the main thread and cannot disturb camera frame timing
 * (the jitter module measures that timing in the browser).
 */
function seeded(seed: number) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

export default function AmbientBackground() {
  const net = useMemo(() => {
    const rnd = seeded(42)
    const W = 1600, H = 1000
    const pts = Array.from({ length: 64 }, () => ({ x: rnd() * W, y: rnd() * H }))
    const lines: [number, number, number, number, number][] = []
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
        if (d < 150) lines.push([pts[i].x, pts[i].y, pts[j].x, pts[j].y, (1 - d / 150) * 0.07])
      }
    return { W, H, pts, lines }
  }, [])

  return (
    <div aria-hidden="true" className="amb-root">
      <div className="amb-blob amb-a" />
      <div className="amb-blob amb-b" />
      <div className="amb-blob amb-c" />
      <div className="amb-blob amb-d" />
      <div className="amb-net">
        <svg viewBox={`0 0 ${net.W} ${net.H}`} preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          {net.lines.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="rgb(40,32,40)" strokeOpacity={l[4]} strokeWidth="1" />)}
          {net.pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="1.4" fill="rgba(40,32,40,0.16)" />)}
        </svg>
      </div>
    </div>
  )
}
