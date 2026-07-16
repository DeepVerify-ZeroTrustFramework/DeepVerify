"""
Forensic Report Generation.

Generates PDF forensic reports for completed sessions using ReportLab.
Includes session summary, trust score timeline, alert log, and module breakdowns.
"""
import io
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from db.mongo import get_sessions_collection, get_telemetry_collection, get_alerts_collection

router = APIRouter()


@router.get("/sessions/{session_id}/report")
async def generate_report(session_id: str):
    """Generate a forensic PDF report for a session."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import inch, cm
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT

    # Fetch session data
    sessions_col = get_sessions_collection()
    session = await sessions_col.find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Fetch telemetry
    telemetry_col = get_telemetry_collection()
    telemetry_cursor = telemetry_col.find(
        {"session_id": session_id},
        {"_id": 0}
    ).sort("timestamp", 1)
    telemetry = []
    async for entry in telemetry_cursor:
        telemetry.append(entry)

    # Fetch alerts
    alerts_col = get_alerts_collection()
    alerts_cursor = alerts_col.find(
        {"session_id": session_id},
        {"_id": 0}
    ).sort("timestamp", 1)
    alerts = []
    async for alert in alerts_cursor:
        alerts.append(alert)

    # Build PDF
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=1 * cm, bottomMargin=1 * cm)
    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        'DeepVerifyTitle',
        parent=styles['Title'],
        fontSize=24,
        textColor=HexColor('#A4123F'),
        spaceAfter=20,
    )
    heading_style = ParagraphStyle(
        'DeepVerifyHeading',
        parent=styles['Heading2'],
        textColor=HexColor('#A4123F'),
        spaceBefore=15,
        spaceAfter=8,
    )
    body_style = styles['Normal']

    elements = []

    # --- Header ---
    elements.append(Paragraph("DEEPVERIFY", title_style))
    elements.append(Paragraph("Forensic Session Report", styles['Heading3']))
    elements.append(Spacer(1, 15))

    # --- Session Info ---
    elements.append(Paragraph("Session Information", heading_style))
    info_data = [
        ["Session ID:", session_id],
        ["Candidate:", session.get('candidate_name', 'N/A')],
        ["Status:", session.get('status', 'N/A')],
        ["Created:", str(session.get('created_at', 'N/A'))],
        ["Started:", str(session.get('start_time', 'N/A'))],
        ["Ended:", str(session.get('end_time', 'N/A'))],
        ["Flagged:", "Yes" if session.get('flagged_for_review') else "No"],
        ["Consent:", "Recorded" if session.get('consent_timestamp') else "Not recorded"],
    ]
    info_table = Table(info_data, colWidths=[3 * cm, 12 * cm])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 15))

    # --- Thresholds ---
    thresholds = session.get('thresholds', {})
    elements.append(Paragraph("Session Thresholds", heading_style))
    thresh_data = [
        ["Parameter", "Threshold", "Description"],
        ["PCE (τ)", str(thresholds.get('pce_tau', 60.0)), "PRNU authentication threshold"],
        ["SNR (β)", f"{thresholds.get('snr_beta', 3.0):.1f} dB", "rPPG liveness threshold (per-candidate)"],
        ["Jitter (γ)", str(thresholds.get('jitter_gamma', 0.15)), "Jitter CV threshold (per-connection)"],
        ["Gaze (λ)", f"{thresholds.get('behavioral_lambda', 0.3):.2f}", "Behavioral gaze threshold (per-session)"],
    ]
    thresh_table = Table(thresh_data, colWidths=[3 * cm, 3 * cm, 9 * cm])
    thresh_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HexColor('#A4123F')),
        ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#FFFFFF')),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#E5E7EB')),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(thresh_table)
    elements.append(Spacer(1, 15))

    # --- Trust Score Summary ---
    if telemetry:
        elements.append(Paragraph("Trust Score Summary", heading_style))
        scores = [t.get('trust_score', 100) for t in telemetry]
        summary_data = [
            ["Metric", "Value"],
            ["Final Score", f"{scores[-1]:.1f}"],
            ["Average Score", f"{sum(scores)/len(scores):.1f}"],
            ["Minimum Score", f"{min(scores):.1f}"],
            ["Maximum Score", f"{max(scores):.1f}"],
            ["Data Points", str(len(scores))],
        ]

        # Last breakdown
        last_breakdown = telemetry[-1].get('breakdown', {})
        summary_data.extend([
            ["", ""],
            ["Module Breakdown (Final)", "Contribution"],
            ["PRNU", f"{last_breakdown.get('prnu_contribution', 30):.1f} / 30"],
            ["rPPG", f"{last_breakdown.get('rppg_contribution', 30):.1f} / 30"],
            ["Jitter", f"{last_breakdown.get('jitter_contribution', 15):.1f} / 15"],
            ["Behavioral", f"{last_breakdown.get('behavioral_contribution', 25):.1f} / 25"],
        ])

        summary_table = Table(summary_data, colWidths=[5 * cm, 10 * cm])
        summary_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F8F9FA')),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#E5E7EB')),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(summary_table)
        elements.append(Spacer(1, 15))

    # --- Alert Log ---
    elements.append(Paragraph(f"Alert Log ({len(alerts)} alerts)", heading_style))
    if alerts:
        alert_data = [["Time", "Type", "Module", "Severity", "Value"]]
        for a in alerts:
            ts = a.get('timestamp', '')
            if hasattr(ts, 'strftime'):
                ts = ts.strftime('%H:%M:%S')
            elif isinstance(ts, str) and len(ts) > 19:
                ts = ts[11:19]  # Extract HH:MM:SS from ISO string
            alert_data.append([
                str(ts),
                a.get('alert_type', 'N/A'),
                a.get('module', 'N/A'),
                a.get('severity', 'N/A'),
                f"{a.get('value', 0):.2f}",
            ])

        alert_table = Table(alert_data, colWidths=[2.5 * cm, 4 * cm, 3 * cm, 2.5 * cm, 3 * cm])
        alert_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#C62828')),
            ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#FFFFFF')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#E5E7EB')),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
        ]))
        elements.append(alert_table)
    else:
        elements.append(Paragraph("No alerts generated during this session.", body_style))

    elements.append(Spacer(1, 20))

    # --- Footer ---
    elements.append(Paragraph(
        f"Report generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
        ParagraphStyle('Footer', parent=body_style, fontSize=8, textColor=HexColor('#6B7280'))
    ))
    elements.append(Paragraph(
        "DeepVerify — Zero-Trust Interview Integrity Platform",
        ParagraphStyle('FooterBrand', parent=body_style, fontSize=8,
                      textColor=HexColor('#A4123F'), alignment=TA_CENTER)
    ))

    doc.build(elements)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="deepverify_report_{session_id[:8]}.pdf"'
        }
    )
