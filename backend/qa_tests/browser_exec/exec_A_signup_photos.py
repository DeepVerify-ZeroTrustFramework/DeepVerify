import sys, json, re; sys.path.insert(0,'/path/to/work')
from pw_common import *
OUT="/path/to/work/out/manual"; res={}
def rec(id, status, note, shot=None): res[id]=dict(result=status, note=note, shot=shot); print(id, status, "-", note)
def body(pg): return pg.inner_text("body")
with sync_playwright() as p:
    b = launch(p)
    rc = b.new_context(permissions=["camera","microphone"], viewport={"width":1280,"height":800}); r = rc.new_page()   # recruiter window
    cc = b.new_context(permissions=["camera","microphone"], viewport={"width":1280,"height":800}); c = cc.new_page()   # candidate window
    # recruiter signup (state is fresh after restart)
    r.goto(BASE+"/auth/recruiter/signup"); r.wait_for_timeout(800)
    for n,v in [("fullName","Rita Recruiter"),("email","recruiter1@test.com"),("password","Test@1234"),("companyName","TestCorp"),("designation","Technical Recruiter")]: r.fill(f"input[name={n}]",v)
    r.click("text=Register Company Account"); r.wait_for_timeout(2500); print("recruiter at", r.url)
    r.screenshot(path=f"{OUT}/MT-01.png")
    rec("MT-01","Pass" if "/recruiter/dashboard" in r.url else "Fail", f"Signed up recruiter1@test.com; landed on {r.url.replace(BASE,'')}", "MT-01.png")
    # MT-04 duplicate (valid fields this time)
    d=b.new_context().new_page(); d.goto(BASE+"/auth/recruiter/signup"); d.wait_for_timeout(800)
    for n,v in [("fullName","Dup"),("email","recruiter1@test.com"),("password","Test@1234"),("companyName","TestCorp"),("designation","Recruiter")]: d.fill(f"input[name={n}]",v)
    d.click("text=Register Company Account"); d.wait_for_timeout(1800); t=body(d); d.screenshot(path=f"{OUT}/MT-04.png")
    m=[l for l in t.split("\n") if "already exists" in l.lower()]
    rec("MT-04","Pass" if ("signup" in d.url and m) else "Fail", f"Stayed on sign-up; message: {m[:1]}", "MT-04.png")
    # MT-05 photo no face / two faces
    def cand_signup(pg, email, photo=None):
        pg.goto(BASE+"/auth/candidate/signup"); pg.wait_for_timeout(800)
        for n,v in [("fullName","Carl Candidate"),("email",email),("password","Test@1234"),("phone","9876543210"),("college","Test University"),("degree","B.Tech CS")]: pg.fill(f"input[name={n}]",v)
        # graduation year may be a select/input
        for sel in ["input[name=graduationYear]","select[name=graduationYear]","input[name=graduation_year]","select"]:
            el=pg.query_selector(sel)
            if el:
                try:
                    if el.evaluate("e=>e.tagName")=="SELECT": el.select_option(index=1)
                    else: el.fill("2027")
                    break
                except Exception as e: print("grad err", e)
        if photo: pg.set_input_files("input[type=file]", photo)
        pg.wait_for_timeout(600)
        pg.click("text=Complete Registration"); pg.wait_for_timeout(2500)
    p5=b.new_context().new_page()
    cand_signup(p5,"cwall@test.com","/tmp/imgs/wall.jpg"); t1=body(p5); p5.screenshot(path=f"{OUT}/MT-05a.png"); u1=p5.url
    m1=[l for l in t1.split("\n") if re.search(r"face|portrait", l, re.I) and "AWS" not in l]
    cand_signup(p5,"ctwo@test.com","/tmp/imgs/twofaces.jpg"); t2=body(p5); p5.screenshot(path=f"{OUT}/MT-05b.png"); u2=p5.url
    m2=[l for l in t2.split("\n") if re.search(r"face|portrait", l, re.I) and "AWS" not in l]
    print("wall:", u1, m1[:2]); print("two:", u2, m2[:2])
    rec("MT-05","Pass" if ("signup" in u1 and m1 and "signup" in u2 and m2) else "Fail", f"No-face photo -> {m1[:1]}; two-face photo -> {m2[:1]}", "MT-05a.png, MT-05b.png")
    # MT-02 candidate signup with a good photo
    cand_signup(c,"candidate1@test.com","/tmp/imgs/face1.jpg"); c.screenshot(path=f"{OUT}/MT-02.png"); print("candidate at", c.url)
    rec("MT-02","Pass" if "/student/inbox" in c.url else "Fail", f"Signed up candidate1@test.com with face photo; landed on {c.url.replace(BASE,'')}", "MT-02.png")
    rc.storage_state(path="/tmp/rec_state.json"); cc.storage_state(path="/tmp/cand_state.json")
    # explore recruiter dashboard for invite UI
    r.goto(BASE+"/recruiter/dashboard"); r.wait_for_timeout(1500)
    print("RECRUITER BUTTONS", [x.inner_text().strip()[:30] for x in r.query_selector_all("button,a")][:40])
    b.close()
json.dump(res, open("/tmp/secAB.json","w"), indent=1)
