import sys, re, json, time; sys.path.insert(0,'/path/to/work')
from pw_common import *
import cam_fixture, qa_api, flow
tok,inv=qa_api.fresh(f"c{int(time.time())}@test.com"); href="/check/"+inv["session_token"]
with sync_playwright() as p:
    b=launch(p, fake_cam=False); cc=b.new_context(viewport={"width":1280,"height":900}, permissions=["camera","microphone"]); cam_fixture.route_all(cc); cc.add_init_script(cam_fixture.init_script([{"label":"Integrated Webcam (04f2:b6cb)","mode":"genuine"}]))
    c=cc.new_page(); c.goto(BASE+href); c.wait_for_timeout(2000); c.click("text=Grant Permissions"); c.wait_for_timeout(1500)
    for n in (2,3): flow.advance(c,n)
    c.evaluate("window.__camMode='covered'"); c.wait_for_timeout(1500); print("on step", flow.stepno(c), "camera COVERED"); c.click("button.glass-btn-primary"); seen=[]
    for i in range(10):
        c.wait_for_timeout(500); t=c.inner_text("body"); m=re.findall(r"\d+\s*(?:BPM|bpm)", t); seen.append((flow.stepno(c), m[:2]))
        if i==4: c.screenshot(path="/tmp/shots/MT-13_covered.png")
    print(seen); t=c.inner_text("body"); print(t[t.find("STEP 4"):][:600].replace("\n"," | ") if "STEP 4" in t else t[t.find("STEP"):][:400].replace("\n"," | "))
    b.close()
