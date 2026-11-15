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


    c.wait_for_timeout(8000)
    r.click("text=Live Code & Compiler"); r.wait_for_timeout(1500)
    def run_and_time(code, wait_s=12):
        c.click(".monaco-editor"); c.keyboard.press("Control+A"); c.keyboard.press("Delete"); c.keyboard.type(code); c.wait_for_timeout(800)
        # marker: wait until a fresh output appears. Clear first.
        for pg in (c,r):
            try: pg.click("text=Clear", timeout=1500)
            except Exception: pass
        c.wait_for_timeout(500)
        t0=time.time(); c.click("button:has-text('Run')"); tc=tr=None
        while time.time()-t0 < wait_s and (tc is None or tr is None):
            if tc is None and re.search(r"SUCCESS|ERROR|TIMEOUT|Timed out|FAILED", c.inner_text("body")): tc=time.time()-t0
            if tr is None and re.search(r"SUCCESS|ERROR|TIMEOUT|Timed out|FAILED", r.inner_text("body")): tr=time.time()-t0
            time.sleep(0.05)
        return tc, tr
    tc,tr=run_and_time("print(2+3)"); ev("MT-20 timing: candidate", tc, "recruiter", tr)
    out_c=c.inner_text("body"); out_r=r.inner_text("body"); ev("cand out:", out_c[out_c.find("Terminal Output"):][:120].replace("\n"," | ")); ev("rec out:", out_r[out_r.find("Live Compiler Console"):][:120].replace("\n"," | "))
    R["MT-20t"]=dict(cand=tc, rec=tr)
    tc,tr=run_and_time("while True: pass", 15); ev("infinite loop: candidate", tc, "recruiter", tr)
    out_c=c.inner_text("body"); ev("loop out:", out_c[out_c.find("Terminal Output"):][:200].replace("\n"," | ")); R["loop"]=dict(cand=tc, rec=tr, out=out_c[out_c.find("Terminal Output"):][:200])
    json.dump(dict(R=R, EV=EV), open("/tmp/sessF.json","w"), indent=1, default=str)
    bc.close(); br.close()
