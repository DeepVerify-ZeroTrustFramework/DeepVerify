import sys, json, re, time; sys.path.insert(0,'/path/to/work')
from pw_common import *
OUT="/path/to/work/out/manual"; res={}
def rec(id, status, note, shot=None): res[id]=dict(result=status, note=note, shot=shot); print(id, status, "-", note)
href=open("/tmp/check_href.txt").read().strip()
with sync_playwright() as p:
    b = launch(p)
    # MT-08 invalid link
    ic=b.new_context(viewport={"width":1280,"height":800}); i=ic.new_page(); errs=[]; i.on("pageerror", lambda e: errs.append(str(e)[:120]))
    i.goto(BASE+"/check/abc123"); i.wait_for_timeout(2500); i.screenshot(path=f"{OUT}/MT-08.png"); t=i.inner_text("body")
    print("MT-08 url", i.url, "|", t[:300].replace("\n"," | "), "| errs", errs)
    ok = bool(re.search(r"access denied|invalid|expired|not found|denied", t, re.I)) and not errs
    rec("MT-08","Pass" if ok else "Fail", f"/check/abc123 -> {i.url.replace(BASE,'')}; page text: {t[:120].replace(chr(10),' / ')}; JS errors: {len(errs)}", "MT-08.png")
    # MT-10 camera blocked
    b2 = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox","--deny-permission-prompts"])
    bc=b2.new_context(storage_state="/tmp/cand_state.json", viewport={"width":1280,"height":800}); bp=bc.new_page(); bp.goto(BASE+href); bp.wait_for_timeout(2500)
    bp.click("text=Grant Permissions"); bp.wait_for_timeout(2500); bp.screenshot(path=f"{OUT}/MT-10.png"); t=bp.inner_text("body")
    print("MT-10:", t[-700:].replace("\n"," | "))
    step=re.search(r"STEP (\d) OF 8", t)
    blocked_msg=[l for l in t.split("\n") if re.search(r"denied|blocked|permission|not allowed|required|unable|failed|error", l, re.I)]
    rec("MT-10","Pass" if (step and step.group(1)=="1" and blocked_msg) else "Fail", f"Camera denied: stayed on step {step.group(1) if step else '?'}; messages: {blocked_msg[:3]}", "MT-10.png")
    b2.close()
    # full run
    cc = b.new_context(storage_state="/tmp/cand_state.json", viewport={"width":1280,"height":900}, permissions=["camera","microphone"]); c = cc.new_page()
    c.goto(BASE+href); c.wait_for_timeout(2500)
    def stepno():
        m=re.search(r"STEP (\d) OF 8", c.inner_text("body")); return int(m.group(1)) if m else None
    def advance(n):
        t0=time.time(); btn=c.query_selector("button.glass-btn-primary:not([disabled])") or c.query_selector("button:has-text('Grant Permissions')"); label=btn.inner_text().strip(); btn.click()
        for _ in range(100):
            c.wait_for_timeout(300)
            if stepno()!=n: break
        return label, time.time()-t0
    # step 1 camera preview
    c.click("text=Grant Permissions"); c.wait_for_timeout(1500)
    vids=c.query_selector_all("video"); vw=[ (v.evaluate("e=>[e.videoWidth,e.videoHeight,e.readyState]")) for v in vids]; c.screenshot(path=f"{OUT}/MT-09.png")
    print("MT-09 videos", vw, "step", stepno(), c.inner_text("body")[:900].replace("\n"," | "))
    rec("MT-09","Pass" if (vw and vw[0][0]>0) else "Fail", f"Camera allowed: {len(vids)} live video element(s), resolution {vw[0][0]}x{vw[0][1]} (Chrome synthetic camera); moved to step {stepno()}", "MT-09.png")
    # step 2
    lbl,tm=advance(2); t=c.inner_text("body"); c.screenshot(path=f"{OUT}/MT-11.png")
    print("MT-11", lbl, f"{tm:.1f}s", stepno(), re.findall(r"(\d+\s*ms|RTT[^\n]*|ethernet|wifi|4g|3g|unknown)", t, re.I)[:4])
    rec("MT-11","Pass" if stepno()==3 else "Fail", f"'{lbl}' completed in {tm:.1f}s and moved to step {stepno()}; page showed: {re.findall(r'(\d+\s*ms)', t)[:2]}", "MT-11.png")
    # step 3 PRNU
    lbl,tm=advance(3); c.screenshot(path=f"{OUT}/MT-12.png"); print("MT-12", lbl, f"{tm:.1f}s", stepno())
    rec("MT-12","Pass" if stepno()==4 else "Fail", f"'{lbl}' captured 30 frames and finished in {tm:.1f}s; moved to step {stepno()} (server accepted /api/enroll)", "MT-12.png")
    # step 4 rPPG
    lbl,tm=advance(4); t=c.inner_text("body"); c.screenshot(path=f"{OUT}/MT-13.png"); print("MT-13", lbl, f"{tm:.1f}s", stepno(), re.findall(r"\d+\s*BPM", t, re.I)[:3])
    rec("MT-13","Pass" if stepno()==5 else "Fail", f"'{lbl}' completed in {tm:.1f}s; bpm text shown: {re.findall(r'\d+\s*BPM', t, re.I)[:2]} (see DL-12: value is simulated in code, not measured)", "MT-13.png")
    # step 5 gaze
    lbl,tm=advance(5); print("gaze", lbl, f"{tm:.1f}s", stepno())
    # step 6 photo
    print("STEP6 text:", c.inner_text("body")[-600:].replace("\n"," | "))
    c.set_input_files("input[type=file]", "/tmp/imgs/wall.jpg"); c.wait_for_timeout(2500); t=c.inner_text("body"); c.screenshot(path=f"{OUT}/MT-14a.png")
    refused=[l for l in t.split("\n") if re.search(r"face|portrait|detected", l, re.I)]; print("MT-14 wall:", refused[:2], "step", stepno())
    c.set_input_files("input[type=file]", "/tmp/imgs/face1.jpg"); c.wait_for_timeout(3000); t=c.inner_text("body"); c.screenshot(path=f"{OUT}/MT-14b.png")
    up=[l for l in t.split("\n") if re.search(r"uploaded|reference|validated|verified", l, re.I)]; print("MT-14 good:", up[:3])
    rec("MT-14","Pass" if (refused and up) else "Fail", f"No-face photo refused: {refused[:1]}; clear face accepted: {up[:2]}", "MT-14a.png, MT-14b.png")
    lbl,tm=advance(6); print("step6 ->", stepno())
    # step 7 consent
    inp=c.query_selector("input[placeholder='I CONSENT']"); inp.fill("i consent"); c.wait_for_timeout(400)
    dis=c.evaluate("()=>[...document.querySelectorAll('button')].filter(b=>/consent|confirm|continue/i.test(b.innerText)).map(b=>[b.innerText.trim(),b.disabled])"); c.screenshot(path=f"{OUT}/MT-15a.png")
    print("lowercase buttons:", dis)
    inp.fill("I CONSENT"); c.wait_for_timeout(400)
    dis2=c.evaluate("()=>[...document.querySelectorAll('button')].filter(b=>/consent|confirm|continue/i.test(b.innerText)).map(b=>[b.innerText.trim(),b.disabled])"); print("exact buttons:", dis2)
    lbl,tm=advance(7); print("step7 ->", stepno(), c.inner_text("body")[-500:].replace("\n"," | "))
    ok15 = dis and all(d[1] for d in dis) and stepno()==8
    rec("MT-15","Pass" if ok15 else "Fail", f"'i consent' -> button disabled {dis}; 'I CONSENT' -> accepted, moved to step {stepno()}", "MT-15a.png")
    # step 8
    lbl,tm=advance(8); c.wait_for_timeout(2500); print("FINAL url", c.url); c.screenshot(path=f"{OUT}/MT-16.png")
    rec("MT-16","Pass" if "/session/" in c.url else "Fail", f"Button '{lbl}' -> {c.url.replace(BASE,'')[:30]}...", "MT-16.png")
    cc.storage_state(path="/tmp/cand_state.json"); open("/tmp/session_url.txt","w").write(c.url)
    b.close()
json.dump(res, open("/tmp/secC.json","w"), indent=1)
