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
    c.click("text=Capture Photo & Verify Face"); c.wait_for_timeout(5000); c.click("text=Enter Full Screen to Continue", timeout=8000); c.wait_for_timeout(2000)

    c.wait_for_timeout(20000)
    # ---- MT-18 tab switching x3 (simulated visibilitychange: headless Chrome cannot hide a tab)
    pre=len(parse_alerts(r.inner_text("body"))); tabs=[]
    for k in range(3):
        c.evaluate("""()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'}); document.dispatchEvent(new Event('visibilitychange'));}""")
        c.wait_for_timeout(1200); body=c.inner_text("body"); toast=[l for l in body.split("\n") if "Tab switched" in l or "Tab switch" in l][:2]
        c.evaluate("""()=>{delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'));}"""); c.wait_for_timeout(2500)
        ev(f"tab switch {k+1}: toast={toast}"); tabs.append(toast)
    c.wait_for_timeout(2500); al=parse_alerts(r.inner_text("body")); ts=[a for a in al if "TAB" in a["type"]]; ev("MT-18 alerts:", [(a['type'],a['sev'],a['msg']) for a in ts]); R["MT-18"]=dict(tabs=tabs, alerts=ts)
    r.screenshot(path="/tmp/shots/MT-18_dash.png")
    # ---- MT-22 second person (two large faces in frame)
    pre=score(r.inner_text("body")); c.evaluate("window.__camMode='two'"); s3=[]; badges=[]
    for i in range(5): 
        c.wait_for_timeout(5000); s3.append(score(r.inner_text("body"))); badges.append(re.findall(r"\d FACES?", c.inner_text("body")))
    t=r.inner_text("body"); al=parse_alerts(t); ev("MT-22 before", pre, "after", s3, "cand badge:", badges); ev("alerts:", [(a["type"],a["sev"],a["msg"][:60]) for a in al[:8]]); R["MT-22"]=dict(before=pre, series=s3, alerts=al[:10], badges=badges)
    r.screenshot(path="/tmp/shots/MT-22_dash.png"); c.evaluate("window.__camMode='normal'"); c.wait_for_timeout(3000)
    # ---- MT-27 end session + pdf
    r.click("text=End Session"); r.wait_for_timeout(1000); r.click("text=Yes, End Session"); r.wait_for_timeout(5000)
    t=r.inner_text("body"); ev("after end:", t[:900].replace("\n"," | ")); print("BUTTONS", [x.inner_text().strip()[:30] for x in r.query_selector_all("button")][:12])
    r.screenshot(path="/tmp/shots/MT-27_end.png")
    try:
        with r.expect_download(timeout=30000) as dl: r.click("text=Download PDF Report")
        d=dl.value; path="/tmp/shots/report_"+sid+".pdf"; d.save_as(path); ev("PDF saved", path, d.suggested_filename); R["MT-27"]=dict(pdf=path, name=d.suggested_filename)
    except Exception as e: ev("PDF ERR", str(e)[:200]); R["MT-27"]=dict(err=str(e)[:200])
    ev("cand after end:", c.inner_text("body")[:300].replace("\n"," | ")); R["MT-27"]["cand_after"]=c.inner_text("body")[:300]
    json.dump(dict(R=R, EV=EV, sid=sid), open("/tmp/sessE.json","w"), indent=1, default=str)
    bc.close(); br.close()
