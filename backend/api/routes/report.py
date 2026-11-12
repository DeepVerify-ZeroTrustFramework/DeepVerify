"""
Forensic Report Generation.

Generates the PDF forensic report for a session using ReportLab:
verdict, candidate & session details, module breakdown, trust-score timeline,
thresholds and the full alert log.

Routes (same handler):
    GET /api/sessions/{session_id}/report
    GET /api/reports/{session_id}/pdf          (used by the interviewer dashboard)

Query: tz = viewer's UTC offset in minutes (e.g. 330 for IST). All stored times
are UTC; the report prints them in the viewer's local time.
"""
import io
import re
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from db.mongo import get_sessions_collection, get_telemetry_collection, get_alerts_collection

router = APIRouter()

# ── Palette (matches the app) ──
MAROON = '#A4123F'
MAROON_DARK = '#7A0D2E'
INK = '#141114'
MUTED = '#67636C'
FAINT = '#85818A'
LINE = '#E7E3E1'
SOFT = '#F7F5F3'
GREEN = '#1A6B3C'
AMBER = '#B45309'
RED = '#991B1B'

MODULES = [  # (label, breakdown key, legacy key, max points, what it checks)
    ('PRNU identity', 'prnu', 'prnu_contribution', 30, 'Camera sensor fingerprint'),
    ('rPPG liveness', 'rppg', 'rppg_contribution', 30, 'Pulse signal in the face'),
    ('Behavioral', 'behavioral', 'behavioral_contribution', 25, 'Gaze, focus and tab activity'),
    ('Jitter', 'jitter', 'jitter_contribution', 15, 'Frame-timing consistency'),
]

SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
SEVERITY_COLOR = {'CRITICAL': RED, 'HIGH': '#DC2626', 'MEDIUM': AMBER, 'LOW': GREEN, 'INFO': FAINT}


# ── Helpers ──────────────────────────────────────────────────────────────────
def _to_dt(v: Any) -> Optional[datetime]:
    """Stored times are naive UTC datetimes or ISO strings (with or without 'Z')."""
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo is None else (v - v.utcoffset()).replace(tzinfo=None)
    if isinstance(v, (int, float)) and v > 1e9:
        return datetime.utcfromtimestamp(v)
    if isinstance(v, str) and v:
        s = v.strip().replace('Z', '+00:00')
        try:
            d = datetime.fromisoformat(s)
        except ValueError:
            return None
        if d.tzinfo is not None:
            d = (d - d.utcoffset()).replace(tzinfo=None)
        return d
    return None


def _tz_label(tz: int) -> str:
    sign = '+' if tz >= 0 else '-'
    h, m = divmod(abs(tz), 60)
    return f'UTC{sign}{h:02d}:{m:02d}'


def _fmt(v: Any, tz: int, fmt: str = '%d %b %Y, %I:%M:%S %p') -> str:
    d = _to_dt(v)
    if not d:
        return '—'
    return (d + timedelta(minutes=tz)).strftime(fmt)


def _num(v: Any, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if f == f else default  # NaN guard
    except (TypeError, ValueError):
        return default


def _esc(s: Any) -> str:
    return str(s if s is not None else '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _verdict(score: float):
    if score >= 80:
        return 'VERIFIED', GREEN, 'No significant integrity concerns were detected.'
    if score >= 60:
        return 'CAUTION', AMBER, 'Some anomalies were detected. Review the alert log before deciding.'
    return 'CRITICAL', RED, 'Strong signs of an integrity risk. Manual review is required.'


def _duration(start: Any, end: Any) -> str:
    a, b = _to_dt(start), _to_dt(end)
    if not a or not b or b < a:
        return '—'
    secs = int((b - a).total_seconds())
    h, r = divmod(secs, 3600)
    m, s = divmod(r, 60)
    return f'{h}h {m:02d}m {s:02d}s' if h else f'{m}m {s:02d}s'


# ── PDF builder (pure function, no DB access) ───────────────────────────────
def build_report_pdf(session: dict, telemetry: list, alerts: list, tz: int = 0) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor, white
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
    from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                    Table, TableStyle, KeepTogether)
    from reportlab.graphics.shapes import Drawing, Rect, String, Line, PolyLine

    W, H = A4
    MX = 16 * mm
    CW = W - 2 * MX  # content width

    C = lambda h: HexColor(h)  # noqa: E731

    def ps(name, size=9.5, color=INK, bold=False, lead=None, align=TA_LEFT, space=0):
        return ParagraphStyle(name, fontName='Helvetica-Bold' if bold else 'Helvetica', fontSize=size,
                              leading=lead or size * 1.35, textColor=C(color), alignment=align, spaceAfter=space)

    s_h2 = ps('h2', 12.5, INK, True, space=0)
    s_label = ps('label', 7.5, FAINT, True)
    s_body = ps('body', 9.5, INK)
    s_muted = ps('muted', 8.5, MUTED)
    s_small = ps('small', 8, MUTED)
    s_cell = ps('cell', 8.5, INK, lead=11)
    s_cell_b = ps('cellb', 8.5, INK, True, lead=11)

    session_id = session.get('session_id', '—')
    fv = session.get('face_verification') or {}
    generated = _fmt(datetime.utcnow(), tz)

    # ── Scores ──
    scores = [_num(t.get('trust_score'), 100.0) for t in telemetry if t.get('trust_score') is not None]
    final = scores[-1] if scores else _num(session.get('trust_score'), 100.0)
    avg = sum(scores) / len(scores) if scores else final
    low = min(scores) if scores else final
    verdict, vcolor, vtext = _verdict(final)
    if not scores:
        verdict, vcolor, vtext = 'NO DATA', FAINT, 'No forensic measurements were recorded for this session.'
    bd = (telemetry[-1].get('breakdown') if telemetry else None) or session.get('breakdown') or {}

    # ── Alert counts ──
    counts = {k: 0 for k in SEVERITY_ORDER}
    for a in alerts:
        sev = str(a.get('severity', 'INFO')).upper()
        counts[sev if sev in counts else 'INFO'] += 1

    # ── Page decoration ──
    def on_page(canvas, doc):
        canvas.saveState()
        # header band
        canvas.setFillColor(C(MAROON))
        canvas.rect(0, H - 22 * mm, W, 22 * mm, stroke=0, fill=1)
        canvas.setFillColor(C(MAROON_DARK))
        canvas.rect(0, H - 22 * mm, W, 1.2 * mm, stroke=0, fill=1)
        # shield mark
        cx, cy = MX + 4.5 * mm, H - 11 * mm
        canvas.setFillColor(white)
        p = canvas.beginPath()
        p.moveTo(cx, cy + 5 * mm); p.lineTo(cx + 4 * mm, cy + 3.5 * mm); p.lineTo(cx + 4 * mm, cy - 0.5 * mm)
        p.curveTo(cx + 4 * mm, cy - 3.5 * mm, cx + 1.5 * mm, cy - 5 * mm, cx, cy - 5.5 * mm)
        p.curveTo(cx - 1.5 * mm, cy - 5 * mm, cx - 4 * mm, cy - 3.5 * mm, cx - 4 * mm, cy - 0.5 * mm)
        p.lineTo(cx - 4 * mm, cy + 3.5 * mm); p.close()
        canvas.drawPath(p, stroke=0, fill=1)
        canvas.setStrokeColor(C(MAROON)); canvas.setLineWidth(1.4)
        canvas.line(cx - 1.8 * mm, cy, cx - 0.4 * mm, cy - 1.5 * mm)
        canvas.line(cx - 0.4 * mm, cy - 1.5 * mm, cx + 2 * mm, cy + 1.6 * mm)
        canvas.setFillColor(white)
        canvas.setFont('Helvetica-Bold', 15)
        canvas.drawString(MX + 12 * mm, H - 11.6 * mm, 'DeepVerify')
        canvas.setFont('Helvetica', 8.5)
        canvas.setFillColor(HexColor('#F5D5DF'))
        canvas.drawString(MX + 12 * mm, H - 16 * mm, 'Forensic Interview Integrity Report')
        canvas.setFont('Helvetica', 8)
        canvas.drawRightString(W - MX, H - 11.6 * mm, f'Session {session_id}')
        canvas.drawRightString(W - MX, H - 16 * mm, f'Generated {generated} ({_tz_label(tz)})')
        # footer
        canvas.setStrokeColor(C(LINE)); canvas.setLineWidth(0.6)
        canvas.line(MX, 13 * mm, W - MX, 13 * mm)
        canvas.setFont('Helvetica', 7.5); canvas.setFillColor(C(FAINT))
        canvas.drawString(MX, 9 * mm, 'Confidential · DeepVerify Zero-Trust Interview Integrity Platform')
        canvas.drawRightString(W - MX, 9 * mm, f'Page {doc.page}')
        canvas.restoreState()

    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=MX, rightMargin=MX, topMargin=30 * mm, bottomMargin=20 * mm,
                          title=f'DeepVerify report – {session.get("candidate_name", session_id)}', author='DeepVerify')
    doc.addPageTemplates([PageTemplate(id='p', frames=[Frame(MX, 20 * mm, CW, H - 50 * mm, id='f', leftPadding=0,
                                                                rightPadding=0, topPadding=0, bottomPadding=0)],
                                       onPage=on_page)])
    el = []

    def section(title: str, sub: str = ''):
        el.append(Spacer(1, 7 * mm))
        el.append(Paragraph(title, s_h2))
        if sub:
            el.append(Paragraph(sub, s_small))
        el.append(Spacer(1, 3 * mm))

    # ── 1. Verdict card ──────────────────────────────────────────────────────
    gauge = Drawing(34 * mm, 34 * mm)
    r = 15 * mm
    gx, gy = 17 * mm, 17 * mm
    from reportlab.graphics.shapes import Wedge, Circle
    gauge.add(Circle(gx, gy, r, fillColor=C('#EFEBE9'), strokeColor=None))
    sweep = max(0.0, min(100.0, final)) / 100 * 360
    if sweep > 0 and scores:
        gauge.add(Wedge(gx, gy, r, 90 - sweep, 90, fillColor=C(vcolor), strokeColor=None))
    gauge.add(Circle(gx, gy, r - 3.2 * mm, fillColor=white, strokeColor=None))
    gauge.add(String(gx, gy - 1.5 * mm, f'{final:.0f}' if scores else '—', fontName='Helvetica-Bold', fontSize=20,
                     fillColor=C(INK), textAnchor='middle'))
    gauge.add(String(gx, gy - 6 * mm, 'TRUST', fontName='Helvetica-Bold', fontSize=6, fillColor=C(FAINT),
                     textAnchor='middle'))

    verdict_tbl = Table([[
        gauge,
        [Paragraph('OVERALL VERDICT', s_label), Spacer(1, 1.5 * mm),
         Paragraph(f'<font color="{vcolor}">{verdict}</font>', ps('v', 20, vcolor, True, lead=23)),
         Spacer(1, 1.5 * mm), Paragraph(vtext, s_muted), Spacer(1, 3 * mm),
         Paragraph(f'<b>{_esc(session.get("candidate_name", "Candidate"))}</b> · {_esc(session.get("role", "—"))}', s_body)],
        Table([
            [Paragraph('AVERAGE', s_label), Paragraph(f'<b>{avg:.1f}</b>' if scores else '<b>—</b>', ps('n', 13, INK, True, align=TA_RIGHT))],
            [Paragraph('LOWEST', s_label), Paragraph(f'<b>{low:.1f}</b>' if scores else '<b>—</b>', ps('n2', 13, INK, True, align=TA_RIGHT))],
            [Paragraph('ALERTS', s_label), Paragraph(f'<b>{len(alerts)}</b>', ps('n3', 13, INK, True, align=TA_RIGHT))],
            [Paragraph('FACE MATCH', s_label), Paragraph(
                f'<b>{_num(fv.get("similarity")):.1f}%</b>' if fv.get('verified') else '<b>Not verified</b>',
                ps('n4', 11 if fv.get('verified') else 9.5, GREEN if fv.get('verified') else AMBER, True, align=TA_RIGHT))],
        ], colWidths=[22 * mm, 22 * mm], style=TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LINEBELOW', (0, 0), (-1, -2), 0.5, C(LINE)),
            ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ])),
    ]], colWidths=[40 * mm, CW - 40 * mm - 50 * mm, 50 * mm])
    verdict_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), C(SOFT)),
        ('BOX', (0, 0), (-1, -1), 0.6, C(LINE)),
        ('LINEBEFORE', (0, 0), (0, 0), 3, C(vcolor)),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 4 * mm), ('BOTTOMPADDING', (0, 0), (-1, -1), 4 * mm),
        ('LEFTPADDING', (0, 0), (-1, -1), 4 * mm), ('RIGHTPADDING', (0, 0), (-1, -1), 5 * mm),
    ]))
    el.append(verdict_tbl)

    # ── 2. Candidate & session ───────────────────────────────────────────────
    section('Candidate & session')
    start, end = session.get('start_time') or session.get('created_at'), session.get('end_time')
    rows = [
        ('Candidate', session.get('candidate_name', '—')), ('Email', session.get('candidate_email', '—')),
        ('Role', session.get('role', '—')), ('Interview type', session.get('interview_type', '—')),
        ('Interviewer', session.get('interviewer_name', '—')), ('Status', session.get('status', '—')),
        ('Started', _fmt(start, tz)), ('Ended', _fmt(end, tz)),
        ('Duration', _duration(start, end)), ('Scheduled length', f'{session["duration"]} min' if session.get('duration') else '—'),
        ('Identity check', (f'Verified · {_num(fv.get("similarity")):.2f}% similarity' if fv.get('verified')
                            else str(fv.get('status') or 'Not verified').title())),
        ('Consent', 'Recorded' if session.get('consent_timestamp') else 'Not recorded'),
        ('Flagged for review', 'Yes' if session.get('flagged_for_review') else 'No'),
        ('Session ID', session_id),
    ]
    grid = []
    for i in range(0, len(rows), 2):
        pair = rows[i:i + 2] + [('', '')] * (2 - len(rows[i:i + 2]))
        grid.append([Paragraph(pair[0][0].upper(), s_label), Paragraph(_esc(pair[0][1]), s_cell_b),
                     Paragraph(pair[1][0].upper(), s_label), Paragraph(_esc(pair[1][1]), s_cell_b)])
    t = Table(grid, colWidths=[28 * mm, CW / 2 - 28 * mm, 28 * mm, CW / 2 - 28 * mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, C(LINE)),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    el.append(t)

    # ── 3. Module breakdown ──────────────────────────────────────────────────
    section('Forensic module breakdown', 'Final contribution of each module to the 100-point trust score.')
    mrows = []
    bar_w = 70 * mm
    for label, key, legacy, mx, what in MODULES:
        val = _num(bd.get(key, bd.get(legacy)), 0.0)
        frac = max(0.0, min(1.0, val / mx))
        col = GREEN if frac >= 0.8 else AMBER if frac >= 0.5 else RED
        d = Drawing(bar_w, 4 * mm)
        d.add(Rect(0, 1.2 * mm, bar_w, 1.8 * mm, rx=0.9 * mm, ry=0.9 * mm, fillColor=C('#ECE8E6'), strokeColor=None))
        if frac > 0:
            d.add(Rect(0, 1.2 * mm, max(1.8 * mm, bar_w * frac), 1.8 * mm, rx=0.9 * mm, ry=0.9 * mm,
                       fillColor=C(col), strokeColor=None))
        mrows.append([Paragraph(f'<b>{label}</b>', s_cell), Paragraph(what, s_small), d,
                      Paragraph(f'<b>{val:.1f}</b> <font color="{FAINT}">/ {mx}</font>', ps('m', 9, INK, align=TA_RIGHT))])
    mt = Table(mrows, colWidths=[30 * mm, CW - 30 * mm - bar_w - 22 * mm - 4 * mm, bar_w + 4 * mm, 22 * mm])
    mt.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, C(LINE)),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    el.append(mt)

    # ── 4. Trust-score timeline ──────────────────────────────────────────────
    pts = [(_to_dt(t.get('timestamp')), _num(t.get('trust_score'), 100.0)) for t in telemetry]
    pts = [(d, s) for d, s in pts if d]
    if len(pts) >= 2:
        step = max(1, len(pts) // 400)
        pts = pts[::step] + ([pts[-1]] if (len(pts) - 1) % step else [])
        t0, t1 = pts[0][0], pts[-1][0]
        span = max(1.0, (t1 - t0).total_seconds())
        cw_, ch_ = CW, 48 * mm
        left, bottom, pw, ph = 9 * mm, 6 * mm, cw_ - 11 * mm, ch_ - 9 * mm
        dr = Drawing(cw_, ch_)
        dr.add(Rect(left, bottom, pw, ph, fillColor=C(SOFT), strokeColor=None))
        for y, col, lab in [(80, GREEN, '80'), (60, AMBER, '60')]:
            yy = bottom + ph * y / 100
            dr.add(Line(left, yy, left + pw, yy, strokeColor=C(col), strokeWidth=0.6, strokeDashArray=[2, 2]))
            dr.add(String(left - 1.5 * mm, yy - 1, lab, fontName='Helvetica', fontSize=6.5, fillColor=C(col), textAnchor='end'))
        for y in (0, 100):
            dr.add(String(left - 1.5 * mm, bottom + ph * y / 100 - 2, str(y), fontName='Helvetica', fontSize=6.5,
                          fillColor=C(FAINT), textAnchor='end'))
        coords = []
        for d_, s_ in pts:
            coords += [left + pw * (d_ - t0).total_seconds() / span, bottom + ph * max(0, min(100, s_)) / 100]
        dr.add(PolyLine(coords, strokeColor=C(MAROON), strokeWidth=1.3))
        for frac in (0, 0.5, 1):
            tt = t0 + timedelta(seconds=span * frac)
            dr.add(String(left + pw * frac, 1 * mm, _fmt(tt, tz, '%I:%M:%S %p'), fontName='Helvetica', fontSize=6.5,
                          fillColor=C(FAINT), textAnchor={0: 'start', 0.5: 'middle', 1: 'end'}[frac]))
        el.append(KeepTogether([Spacer(1, 7 * mm), Paragraph('Trust score over time', s_h2),
                                Paragraph(f'{len(telemetry)} measurements. Dashed lines mark the caution (80) and critical (60) bands.', s_small),
                                Spacer(1, 3 * mm), dr]))

    # ── 5. Thresholds ────────────────────────────────────────────────────────
    th = session.get('thresholds') or {}
    section('Session thresholds', 'Per-session calibration used by each detector.')
    trows = [[Paragraph('PARAMETER', s_label), Paragraph('THRESHOLD', s_label), Paragraph('MEANING', s_label)],
             [Paragraph('<b>PCE (τ)</b>', s_cell), Paragraph(f'{_num(th.get("pce_tau"), 60.0):.1f}', s_cell), Paragraph('PRNU authentication: minimum peak-to-correlation energy', s_cell)],
             [Paragraph('<b>SNR (β)</b>', s_cell), Paragraph(f'{_num(th.get("snr_beta"), 3.0):.1f} dB', s_cell), Paragraph('rPPG liveness: minimum pulse signal-to-noise (per candidate)', s_cell)],
             [Paragraph('<b>Jitter (γ)</b>', s_cell), Paragraph(f'{_num(th.get("jitter_gamma"), 0.15):.2f}', s_cell), Paragraph('Frame-timing: maximum coefficient of variation (per connection)', s_cell)],
             [Paragraph('<b>Gaze (λ)</b>', s_cell), Paragraph(f'{_num(th.get("behavioral_lambda"), 0.3):.2f}', s_cell), Paragraph('Behavioral: maximum gaze deviation (per session)', s_cell)]]
    tt_ = Table(trows, colWidths=[30 * mm, 28 * mm, CW - 58 * mm])
    tt_.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, C(LINE)),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    el.append(tt_)

    # ── 6. Alert log ─────────────────────────────────────────────────────────
    section(f'Alert log · {len(alerts)} alert{"s" if len(alerts) != 1 else ""}',
            f'Times shown in {_tz_label(tz)}.' + ('' if not alerts else '  ' + '   '.join(
                f'<font color="{SEVERITY_COLOR[k]}"><b>{k.title()}</b></font> {counts[k]}' for k in SEVERITY_ORDER if counts[k])))
    if alerts:
        arows = [[Paragraph('TIME', s_label), Paragraph('SEVERITY', s_label), Paragraph('MODULE · TYPE', s_label),
                  Paragraph('DETAILS', s_label), Paragraph('VALUE', ps('vl', 7.5, FAINT, True, align=TA_RIGHT))]]
        styles_extra = []
        for i, a in enumerate(alerts, start=1):
            sev = str(a.get('severity', 'INFO')).upper()
            col = SEVERITY_COLOR.get(sev, FAINT)
            atype = str(a.get('alert_type') or a.get('alertType') or 'ALERT').replace('_', ' ')
            desc = a.get('description') or a.get('message') or ''
            ack = ' <font color="#85818A">· acknowledged</font>' if a.get('acknowledged') else ''
            arows.append([
                Paragraph(_fmt(a.get('timestamp'), tz, '%I:%M:%S %p'), s_cell),
                Paragraph(f'<font color="{col}"><b>{sev}</b></font>', ps(f'sv{i}', 7.5, col, True)),
                Paragraph(f'<b>{_esc(a.get("module", "—"))}</b><br/><font color="{MUTED}" size="7.5">{_esc(atype)}</font>', s_cell),
                Paragraph(_esc(desc) + ack, s_cell),
                Paragraph(f'{_num(a.get("value")):.2f}', ps(f'av{i}', 8.5, INK, align=TA_RIGHT)),
            ])
            if i % 2 == 0:
                styles_extra.append(('BACKGROUND', (0, i), (-1, i), C(SOFT)))
            styles_extra.append(('LINEBEFORE', (0, i), (0, i), 2, C(col)))
        at = Table(arows, colWidths=[22 * mm, 20 * mm, 36 * mm, CW - 22 * mm - 20 * mm - 36 * mm - 16 * mm, 16 * mm],
                   repeatRows=1)
        at.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LINEBELOW', (0, 0), (-1, 0), 0.8, C(INK)),
            ('LINEBELOW', (0, 1), (-1, -1), 0.4, C(LINE)),
            ('TOPPADDING', (0, 0), (-1, -1), 4.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 4.5),
            ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ] + styles_extra))
        el.append(at)
    else:
        el.append(Paragraph('No alerts were raised during this session.', s_muted))

    el.append(Spacer(1, 8 * mm))
    el.append(Paragraph('This report was generated automatically from DeepVerify forensic telemetry. Scores are '
                        'signals for human review, not a final hiring decision.', s_small))

    doc.build(el)
    return buf.getvalue()


def _safe_name(s: str) -> str:
    return re.sub(r'[^A-Za-z0-9]+', '_', s or '').strip('_')[:40] or 'candidate'


@router.get("/sessions/{session_id}/report")
@router.get("/reports/{session_id}/pdf")
async def generate_report(session_id: str, tz: int = 0):
    """Generate a forensic PDF report for a session (downloaded as an attachment)."""
    tz = max(-14 * 60, min(14 * 60, tz))

    session = await get_sessions_collection().find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    telemetry = []
    async for entry in get_telemetry_collection().find(
            {"session_id": session_id},
            {"_id": 0, "timestamp": 1, "trust_score": 1, "breakdown": 1}).sort("timestamp", 1):
        telemetry.append(entry)

    alerts = []
    async for alert in get_alerts_collection().find({"session_id": session_id}, {"_id": 0}).sort("timestamp", 1):
        alerts.append(alert)

    pdf = build_report_pdf(session, telemetry, alerts, tz)
    filename = f'DeepVerify_Report_{_safe_name(session.get("candidate_name", ""))}_{session_id}.pdf'
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/reports/{session_id}/summary")
async def report_summary(session_id: str):
    """Final numbers for a finished session (used by the dashboard's summary screen)."""
    session = await get_sessions_collection().find_one(
        {"session_id": session_id}, {"_id": 0, "status": 1, "face_verification": 1})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    scores, last_breakdown = [], {}
    async for t in get_telemetry_collection().find(
            {"session_id": session_id}, {"_id": 0, "trust_score": 1, "breakdown": 1}).sort("timestamp", 1):
        if t.get("trust_score") is not None:
            scores.append(_num(t.get("trust_score"), 100.0))
        if t.get("breakdown"):
            last_breakdown = t["breakdown"]

    alert_count = await get_alerts_collection().count_documents({"session_id": session_id})
    breakdown = {key: round(_num(last_breakdown.get(key, last_breakdown.get(legacy)), 0.0), 2)
                 for _, key, legacy, _, _ in MODULES}
    return {
        "session_id": session_id,
        "status": session.get("status"),
        "has_data": bool(scores),
        "final_score": round(scores[-1], 1) if scores else None,
        "average_score": round(sum(scores) / len(scores), 1) if scores else None,
        "lowest_score": round(min(scores), 1) if scores else None,
        "breakdown": breakdown,
        "alert_count": alert_count,
    }
