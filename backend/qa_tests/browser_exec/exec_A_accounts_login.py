import sys, json, io; sys.path.insert(0,'/path/to/work')
from pw_common import *
from PIL import Image, ImageDraw
OUT="/path/to/work/out/manual"
res={}
def rec(id, status, note, shot=None): res[id]=dict(result=status, note=note, shot=shot); print(id, status, "-", note)
with sync_playwright() as p:
    b = launch(p); ctx = b.new_context(permissions=["camera","microphone"], viewport={"width":1280,"height":800}); pg = ctx.new_page()
    # MT-01 recruiter signup
    pg.goto(BASE+"/auth/recruiter/signup"); pg.wait_for_timeout(800)
    pg.fill("input[name=fullName]","Rita Recruiter"); pg.fill("input[name=email]","recruiter1@test.com"); pg.fill("input[name=password]","Test@1234")
    pg.fill("input[name=companyName]","TestCorp"); pg.fill("input[name=designation]","Technical Recruiter")
    pg.click("text=Register Company Account"); pg.wait_for_timeout(2500)
    pg.screenshot(path=f"{OUT}/MT-01.png"); print("after signup url", pg.url); print(pg.inner_text("body")[:500].replace("\n"," | "))
    rec("MT-01","Pass" if "/recruiter/dashboard" in pg.url else "Fail", f"landed on {pg.url.replace(BASE,'')}", "MT-01.png")
    ctx.storage_state(path="/tmp/recruiter_state.json")
    # MT-06 protected pages: new clean context
    c2=b.new_context(); p2=c2.new_page(); p2.goto(BASE+"/recruiter/dashboard"); p2.wait_for_timeout(1500)
    p2.screenshot(path=f"{OUT}/MT-06.png"); print("protected ->", p2.url)
    rec("MT-06","Pass" if "/auth/recruiter/login" in p2.url else "Fail", f"unauthenticated /recruiter/dashboard -> {p2.url.replace(BASE,'')}", "MT-06.png")
    # MT-03 wrong password
    p2.goto(BASE+"/auth/recruiter/login"); p2.wait_for_timeout(800)
    p2.fill("input[type=email]","recruiter1@test.com"); p2.fill("input[type=password]","WrongPass1"); p2.click("text=Sign In to Dashboard"); p2.wait_for_timeout(1800)
    txt=p2.inner_text("body"); p2.screenshot(path=f"{OUT}/MT-03.png")
    import re; m=[l for l in txt.split("\n") if re.search(r"invalid|incorrect|wrong|fail|error|denied", l, re.I)]
    print("MT-03 msgs:", m, "url", p2.url)
    rec("MT-03","Pass" if ("login" in p2.url and m) else "Fail", f"stayed on login; message shown: {m[:1]}", "MT-03.png")
    # MT-04 duplicate email
    p2.goto(BASE+"/auth/recruiter/signup"); p2.wait_for_timeout(800)
    p2.fill("input[name=fullName]","Dup"); p2.fill("input[name=email]","recruiter1@test.com"); p2.fill("input[name=password]","Test@1234")
    p2.fill("input[name=companyName]","X"); p2.fill("input[name=designation]","Y"); p2.click("text=Register Company Account"); p2.wait_for_timeout(1800)
    txt=p2.inner_text("body"); p2.screenshot(path=f"{OUT}/MT-04.png")
    m=[l for l in txt.split("\n") if re.search(r"exist|already|registered|duplicate|taken|fail|error", l, re.I)]
    print("MT-04 msgs:", m, "url", p2.url)
    rec("MT-04","Pass" if ("signup" in p2.url and m) else "Fail", f"refused; message: {m[:1]}", "MT-04.png")
    b.close()
json.dump(res, open("/tmp/secA.json","w"), indent=1)
