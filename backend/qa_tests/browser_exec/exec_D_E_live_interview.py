import sys, re, json, time; sys.path.insert(0,'/path/to/work')
from pw_common import *
import cam_fixture, qa_api, flow
R={}; EV=[]
def ev(*a): 
    s=" ".join(str(x) for x in a); EV.append(s); print(s, flush=True)
def parse_alerts(t):
    i=t.find("Anomaly Detection"); seg=t[i:] if i>=0 else t; out=[]
    for blk in seg.split("ACKNOWLEDGE"):
        m=re.search(r"([A-Z_ ]+ · [A-Z0-9_ \-/]+)\s*\n\s*(\d\d:\d\d:\d\d [AP]M)\s*\n+(.*?)\n+\s*(CRITICAL|HIGH|MEDIUM|LOW|INFO)\s*\n\s*Value: ([\d.\-]+)", blk, re.S)
        if m: out.append(dict(type=m.group(1).strip(), time=m.group(2), msg=m.group(3).strip().replace("\n"," ")[:110], sev=m.group(4), value=m.group(5)))
    return out
def score(t):
    m=re.search(r"AGGREGATE TRUST SCORE\s*\n\s*(\d+)\s*\n\s*TRUST\s*\n\s*([A-Z ]+)", t); return (int(m.group(1)), m.group(2).strip()) if m else None
def mods(t):
    return {k:(re.search(k+r"\s*\n\s*([\d.]+) / (\d+)", t) or [None,None])[1] for k in ["PRNU Identity","rPPG Liveness","Behavioral","Jitter Check"]}
with sync_playwright() as p:
    tok,inv=qa_api.fresh(f"c{int(time.time())}@test.com"); sid=inv["session_id"]; href="/check/"+inv["session_token"]; ev("session", sid)
    bc=launch(p, fake_cam=False); br=launch(p, fake_cam=False)
    cc=bc.new_context(viewport={"width":1280,"height":900}, permissions=["camera","microphone","clipboard-read","clipboard-write"], accept_downloads=True); cam_fixture.route_all(cc)
    cc.add_init_script(cam_fixture.init_script([{"label":"Integrated Webcam (04f2:b6cb)","mode":"genuine"}]))
    rc=br.new_context(viewport={"width":1500,"height":1100}, permissions=["camera","microphone"], accept_downloads=True); rc.add_init_script(cam_fixture.init_script([{"label":"Interviewer Cam","mode":"genuine"}]))
    c=cc.new_page(); r=rc.new_page()
    for pg in (c,r):
        cdp=pg.context.new_cdp_session(pg); cdp.send("Emulation.setFocusEmulationEnabled",{"enabled":True})
    flow.run_check(c, href); c.wait_for_timeout(2500)
    r.goto(BASE+"/auth/recruiter/login"); r.fill("input[type=email]","recruiter1@test.com"); r.fill("input[type=password]","Test@1234"); r.click("text=Sign In to Dashboard"); r.wait_for_timeout(1500)
    r.goto(BASE+f"/dashboard/{sid}"); r.wait_for_timeout(3000)
    c.click("text=Capture Photo & Verify Face"); c.wait_for_timeout(5000)
    if not c.query_selector("text=Enter Full Screen to Continue"):
        ev("DEBUG no fullscreen gate; cand text:", c.inner_text("body")[:700].replace("\n"," | ")); c.screenshot(path="/tmp/shots/debug.png")
    c.click("text=Enter Full Screen to Continue", timeout=8000); c.wait_for_timeout(2000)
    # ---- MT-24 baseline
    series=[]
    for i in range(8):
        c.wait_for_timeout(5000); t=r.inner_text("body"); series.append(score(t))
    ev("MT-24 series", series, mods(r.inner_text("body"))); R["MT-24"]=dict(series=series, mods=mods(r.inner_text("body")), alerts=parse_alerts(r.inner_text("body")))
    r.screenshot(path="/tmp/shots/MT-24_dash.png"); 
    # ---- MT-17 fullscreen exit
    c.evaluate("document.exitFullscreen()"); c.wait_for_timeout(1500); t=c.inner_text("body")
    fs=[l for l in t.split("\n") if "Fullscreen" in l or "full screen" in l.lower()]; ev("MT-17 text:", fs[:4]); R["MT-17"]=dict(lines=fs[:4], gate=("Full Screen Required" in t))
    if "Enter Full Screen to Continue" in t: c.click("text=Enter Full Screen to Continue"); c.wait_for_timeout(1500)
    ev("fullscreen back?", c.evaluate("!!document.fullscreenElement"))
    # ---- MT-18 tab switching x3
    pre=len(parse_alerts(r.inner_text("body"))); tabs=[]
    for k in range(3):
        n=cc.new_page(); n.goto("about:blank"); n.bring_to_front(); c.wait_for_timeout(1500)
        hid=c.evaluate("document.hidden"); toast=[l for l in c.inner_text("body").split("\n") if "Tab switched" in l][:1]
        n.close(); c.bring_to_front(); c.wait_for_timeout(2500); ev(f"tab switch {k+1}: hidden={hid} toast={toast}"); tabs.append(dict(hidden=hid, toast=toast))
    c.wait_for_timeout(2500); al=parse_alerts(r.inner_text("body")); ts=[a for a in al if "TAB" in a["type"]]; ev("MT-18 alerts:", ts); R["MT-18"]=dict(tabs=tabs, alerts=ts, all=al)
    if not c.evaluate("!!document.fullscreenElement"):
        if c.query_selector("text=Enter Full Screen to Continue"): c.click("text=Enter Full Screen to Continue"); c.wait_for_timeout(1000)
    # ---- MT-19 paste + context menu
    c.click(".monaco-editor"); c.wait_for_timeout(500)
    c.evaluate("navigator.clipboard.writeText('x='+'A'*400)"); c.keyboard.press("Control+V"); c.wait_for_timeout(1500)
    body=c.inner_text("body"); pasted_in_editor=("AAAA" in body); toast=[l for l in body.split("\n") if re.search(r"Past", l)][:2]
    c.click(".monaco-editor", button="right"); c.wait_for_timeout(800); body2=c.inner_text("body"); ctoast=[l for l in body2.split("\n") if "context menu" in l.lower()][:2]
    menu=c.evaluate("!!document.querySelector('.monaco-menu, .context-view .monaco-menu')")
    ev("MT-19 pasted_in_editor", pasted_in_editor, toast, "ctx toast", ctoast, "menu", menu); c.wait_for_timeout(2500)
    al=parse_alerts(r.inner_text("body")); cl=[a for a in al if re.search(r"CLIP|PASTE|CONTEXT", a["type"]+a["msg"], re.I)]; ev("MT-19 alerts:", cl); R["MT-19"]=dict(pasted_in_editor=pasted_in_editor, toast=toast, ctoast=ctoast, menu=menu, alerts=cl)
    # ---- MT-20 code run
    c.click(".monaco-editor"); c.keyboard.press("Control+A"); c.keyboard.press("Delete"); c.keyboard.type("print(2+3)"); c.wait_for_timeout(600)
    c.click("button:has-text('Run')"); c.wait_for_timeout(5000)
    ct=c.inner_text("body"); ev("CAND after run:", ct[ct.find("Run"):][:500].replace("\n"," | "))
    r.click("text=Live Code & Compiler"); r.wait_for_timeout(1500); rt=r.inner_text("body"); ev("RECRUITER code tab:", rt[:900].replace("\n"," | ")); r.screenshot(path="/tmp/shots/MT-20_dash.png")
    R["MT-20"]=dict(cand=ct[ct.find("Run"):][:400], rec=rt[:900])
    r.click("text=Forensics"); r.wait_for_timeout(800)
    # ---- MT-21 covered camera
    pre=score(r.inner_text("body")); c.evaluate("window.__camMode='covered'"); s2=[]
    for i in range(6): c.wait_for_timeout(5000); s2.append(score(r.inner_text("body")))
    t=r.inner_text("body"); al=parse_alerts(t); ev("MT-21 before", pre, "after", s2, mods(t)); ev("alerts:", [(a["type"],a["sev"]) for a in al[:6]]); R["MT-21"]=dict(before=pre, series=s2, mods=mods(t), alerts=al[:8])
    r.screenshot(path="/tmp/shots/MT-21_dash.png")
    c.evaluate("window.__camMode='normal'"); c.wait_for_timeout(15000)
    # ---- MT-22 second person
    pre=score(r.inner_text("body")); c.evaluate("window.__camMode='two'"); s3=[]
    for i in range(5): c.wait_for_timeout(5000); s3.append(score(r.inner_text("body")))
    t=r.inner_text("body"); al=parse_alerts(t); ev("MT-22 before", pre, "after", s3, "cand badge:", re.findall(r"\d FACES?", c.inner_text("body"))); ev("alerts:", [(a["type"],a["sev"],a["msg"][:50]) for a in al[:6]]); R["MT-22"]=dict(before=pre, series=s3, alerts=al[:8], badge=re.findall(r"\d FACES?", c.inner_text("body")))
    c.evaluate("window.__camMode='normal'"); c.wait_for_timeout(8000)
    # ---- MT-23 refresh
    c.reload(); c.wait_for_timeout(6000); t=c.inner_text("body"); ev("MT-23 after reload cand:", t[:400].replace("\n"," | "), "url", c.url[:40]); R["MT-23"]=dict(text=t[:400], url=c.url[:40])
    if c.query_selector("text=Capture Photo & Verify Face"): 
        try: c.click("text=Capture Photo & Verify Face"); c.wait_for_timeout(4000)
        except Exception as e: ev("verify err", str(e)[:80])
    if c.query_selector("text=Enter Full Screen to Continue"): c.click("text=Enter Full Screen to Continue"); c.wait_for_timeout(1500)
    c.wait_for_timeout(8000); ev("rec after cand reload:", score(r.inner_text("body")), mods(r.inner_text("body")))
    R["MT-23"]["rec_after"]=score(r.inner_text("body"))
    # ---- MT-25 alert feed / MT-26 flag / MT-28 reload
    t=r.inner_text("body"); al=parse_alerts(t); ev("MT-25 feed n=",len(al), "dups:", len(al)-len({(a['type'],a['time'],a['msg']) for a in al})); R["MT-25"]=dict(n=len(al), alerts=al, newest_first=[a["time"] for a in al[:6]])
    r.click("text=Flag Session"); r.wait_for_timeout(1500); t=r.inner_text("body"); ev("MT-26 after flag:", [l for l in t.split("\n") if re.search(r"flag", l, re.I)][:4]); R["MT-26"]=dict(lines=[l for l in t.split("\n") if re.search(r"flag", l, re.I)][:4])
    st=qa_api.requests.get(f"{qa_api.API}/api/sessions/{sid}", headers={"Authorization":"Bearer "+tok}).json(); ev("session flagged field:", {k:v for k,v in st.items() if "flag" in k.lower()}); R["MT-26"]["api"]={k:v for k,v in st.items() if "flag" in k.lower()}
    n_before=len(parse_alerts(r.inner_text("body"))); r.reload(); r.wait_for_timeout(5000); t=r.inner_text("body"); n_after=len(parse_alerts(t)); ev("MT-28 reload: alerts before", n_before, "after", n_after, "score", score(t)); R["MT-28"]=dict(before=n_before, after=n_after, score=score(t), mods=mods(t))
    # ---- MT-27 end session + PDF
    r.click("text=End Session"); r.wait_for_timeout(1500); t=r.inner_text("body"); ev("end dialog:", t[-500:].replace("\n"," | ")); r.screenshot(path="/tmp/shots/MT-27a.png")
    print("BUTTONS", [x.inner_text().strip()[:30] for x in r.query_selector_all("button")][-10:])
    json.dump(dict(R=R, EV=EV, sid=sid), open("/tmp/sessD.json","w"), indent=1, default=str)
    bc.close(); br.close()
