import sys, re, time, json; sys.path.insert(0,'/path/to/work')
from pw_common import *
import cam_fixture
OUT="/path/to/work/out/manual"
def score(t):
    m=re.search(r"TRUST SCORE\s*\n\s*(\d+)", t) or re.search(r"FUSION TRUST SCORE\s*\n\s*(\d+)", t); return int(m.group(1)) if m else None
def modules(t):
    return {k:re.search(k+r"\s*\n\s*([\d.]+) / (\d+)", t).group(1) if re.search(k+r"\s*\n\s*([\d.]+) / (\d+)", t) else None for k in ["PRNU Identity","rPPG Liveness","Behavioral","Jitter Check"]}
with sync_playwright() as p:
    b=launch(p, fake_cam=False)
    ctx=b.new_context(viewport={"width":1400,"height":1000}, permissions=["camera","microphone"]); cam_fixture.route_mediapipe(ctx)
    ctx.add_init_script(cam_fixture.init_script([{"label":"Integrated Webcam (04f2:b6cb)","mode":"genuine"}]))
    pg=ctx.new_page(); pg.goto(BASE+"/demo"); pg.wait_for_timeout(2500)
    pg.click("text=Enroll webcam")
    for i in range(14):
        pg.wait_for_timeout(1000)
        if "Enrolled" in pg.inner_text("body"): break
    pg.set_input_files("input[type=file]","/tmp/imgs/replayed_video.webm"); pg.wait_for_timeout(1500)
    print("after file:", re.findall(r"Simulate cheating:[^\n]*", pg.inner_text("body")))
    pg.click("text=Start live verification")
    series=[]
    for i in range(14):
        pg.wait_for_timeout(5000); t=pg.inner_text("body"); s=score(t); series.append(s); print(f"t={5*(i+1)}s score={s}", modules(t))
    t=pg.inner_text("body"); pg.screenshot(path=f"{OUT}/MT-30.png", full_page=True)
    alerts=t[t.find("FORENSIC ALERTS"):][:1500]; print("ALERTS:", alerts.replace("\n"," | "))
    json.dump(dict(series=series, alerts=alerts, modules=modules(t)), open("/tmp/mt30_file.json","w"))
    b.close()
