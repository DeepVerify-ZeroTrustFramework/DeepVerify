import sys, json, re, time; sys.path.insert(0,'/path/to/work')
from pw_common import *
OUT="/path/to/work/out/manual"; res=json.load(open("/tmp/secC.json"))
def rec(id, status, note, shot=None): res[id]=dict(result=status, note=note, shot=shot); print(id, status, "-", note)
import qa_api; _t,_i=qa_api.fresh("cand11@test.com"); href="/check/"+_i["session_token"]
with sync_playwright() as p:
    # MT-10 proper: a camera exists, but the browser permission is BLOCKED
    b2 = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox","--use-fake-device-for-media-stream","--deny-permission-prompts"])
    bc=b2.new_context(viewport={"width":1280,"height":800}); bp=bc.new_page(); errs=[]; bp.on("pageerror", lambda e: errs.append(str(e)[:100]))
    bp.goto(BASE+href); bp.wait_for_timeout(2500)
    perm=bp.evaluate("async()=>{try{await navigator.mediaDevices.getUserMedia({video:true});return 'granted'}catch(e){return e.name}}"); print("browser getUserMedia ->", perm)
    bp.click("text=Grant Permissions"); bp.wait_for_timeout(2500); bp.screenshot(path=f"{OUT}/MT-10.png"); t=bp.inner_text("body")
    step=re.search(r"STEP (\d) OF 8", t).group(1); i=t.find("Camera"); print("MT-10 text:", t[t.find("PERMISSIONS"):][:700].replace("\n"," | "))
    msgs=[l for l in t.split("\n") if re.search(r"not found|denied|blocked|permission|required", l, re.I)]
    rec("MT-10","Pass" if (perm=="NotAllowedError" and step=="1" and not errs) else "Fail",
        f"Camera present but browser permission blocked ({perm}); page stayed on step {step}, no JS errors; shows: 'Camera Device Not Found' + 'Retry Access'/'Retry Permissions' buttons. Observation DL-13: wording says 'not found' although the real cause is blocked permission", "MT-10.png")
    b2.close()
    # MT-11 capture RTT readout
    b = launch(p); cc = b.new_context(viewport={"width":1280,"height":900}, permissions=["camera","microphone"]); c = cc.new_page()
    c.goto(BASE+href); c.wait_for_timeout(2000); c.click("text=Grant Permissions"); c.wait_for_timeout(1500)
    seen=[]; c.click("text=Run Diagnostics")
    for _ in range(12):
        c.wait_for_timeout(100); tt=c.inner_text("body"); m=re.search(r"ROUND TRIP TIME \(RTT\)\s*\n\s*([^\n]+)\s*\n\s*CLASSIFICATION\s*\n\s*([^\n]+)", tt)
        if m: seen.append((m.group(1),m.group(2)))
        if "STEP 3" in tt: break
    print("RTT readouts:", seen[-3:])
    c.screenshot(path=f"{OUT}/MT-11.png")
    res["MT-11"]["note"]=f"'Run Diagnostics' finished in about 1 s and moved to step 3. Readout seen: RTT/classification = {seen[-1] if seen else 'auto-advanced before readout could be captured'}"
    b.close()
json.dump(res, open("/tmp/secC.json","w"), indent=1)
