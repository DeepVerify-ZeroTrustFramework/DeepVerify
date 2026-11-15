import sys, re, json, time; sys.path.insert(0,'/path/to/work')
from pw_common import *
import qa_api
out={}
with sync_playwright() as p:
    b=launch(p, fake_cam=False)
    for name,(w,h) in {"phone 375x667":(375,667),"small 320x568":(320,568)}.items():
        ctx=b.new_context(viewport={"width":w,"height":h}, device_scale_factor=1)
        pg=ctx.new_page()
        pages=["/", "/auth/recruiter/login", "/auth/candidate/login", "/auth/recruiter/signup", "/demo"]
        for path in pages:
            pg.goto(BASE+path); pg.wait_for_timeout(1500)
            m=pg.evaluate("""()=>{const de=document.documentElement; const over=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && (r.right>innerWidth+2) && getComputedStyle(e).position!=='fixed'}).length; return {scrollW:de.scrollWidth, innerW:innerWidth, overflowingEls:over}}""")
            out[f"{name} {path}"]=m; print(name, path, m)
            pg.screenshot(path=f"/tmp/shots/mobile_{w}_{path.strip('/').replace('/','_') or 'home'}.png")
        # logged-in recruiter dashboard
        r=qa_api.rec_login(); ctx.add_cookies([]); pg.goto(BASE+"/auth/recruiter/login"); pg.fill("input[type=email]","recruiter1@test.com"); pg.fill("input[type=password]","Test@1234"); pg.click("text=Sign In to Dashboard"); pg.wait_for_timeout(2500)
        m=pg.evaluate("""()=>{const de=document.documentElement; const over=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && (r.right>innerWidth+2) && getComputedStyle(e).position!=='fixed'}).length; return {scrollW:de.scrollWidth, innerW:innerWidth, overflowingEls:over, url:location.pathname}}"""); out[f"{name} recruiter dashboard"]=m; print(name,"dashboard",m)
        pg.screenshot(path=f"/tmp/shots/mobile_{w}_dashboard.png"); ctx.close()
    b.close()
json.dump(out, open("/tmp/mobile.json","w"), indent=1)
