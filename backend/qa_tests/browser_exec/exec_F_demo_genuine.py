import sys, re, json, time; sys.path.insert(0,'/path/to/work')
from pw_common import *
import cam_fixture, qa_api
OUT="/path/to/work/out/manual"
def score(t):
    m=re.search(r"TRUST SCORE\s*\n\s*(\d+)", t); return int(m.group(1)) if m else None
def modules(t): return {k:(re.search(k+r"\s*\n\s*([\d.]+) / (\d+)", t) or [None,None])[1] for k in ["PRNU Identity","rPPG Liveness","Behavioral","Jitter Check"]}
res={}
with sync_playwright() as p:
    b=launch(p, fake_cam=False)
    ctx=b.new_context(viewport={"width":1400,"height":1000}, permissions=["camera","microphone"]); cam_fixture.route_all(ctx)
    ctx.add_init_script(cam_fixture.init_script([{"label":"Integrated Webcam (04f2:b6cb)","mode":"genuine"}]))
    pg=ctx.new_page(); pg.goto(BASE+"/demo"); pg.wait_for_timeout(2500); pg.click("text=Enroll webcam")
    for i in range(14):
        pg.wait_for_timeout(1000)
        if "Enrolled" in pg.inner_text("body"): break
    pg.click("text=Start live verification"); series=[]
    for i in range(10): pg.wait_for_timeout(5000); series.append(score(pg.inner_text("body")))
    t=pg.inner_text("body"); res["MT-29"]=dict(series=series, mods=modules(t), alerts=t[t.find("FORENSIC ALERTS"):][:300].replace("\n"," | ")); print("MT-29", res["MT-29"])
    pg.screenshot(path="/tmp/shots/MT-29_full.png", full_page=True)
    # dashboard of the finished interview: ID status after reload
    br=launch(p, fake_cam=False); rc=br.new_context(viewport={"width":1500,"height":1100}); r=rc.new_page()
    r.goto(BASE+"/auth/recruiter/login"); r.fill("input[type=email]","recruiter1@test.com"); r.fill("input[type=password]","Test@1234"); r.click("text=Sign In to Dashboard"); r.wait_for_timeout(1500)
    r.goto(BASE+"/dashboard/DV-2025-7435"); r.wait_for_timeout(4000); t=r.inner_text("body"); print("DASH finished session text:", t[:700].replace("\n"," | "))
    res["idstatus"]=re.findall(r"ID (?:Pending|Verified)[^\n]*|Unverified|Verified", t)[:4]; print(res["idstatus"])
    b.close(); br.close()
json.dump(res, open("/tmp/final1.json","w"), indent=1)
