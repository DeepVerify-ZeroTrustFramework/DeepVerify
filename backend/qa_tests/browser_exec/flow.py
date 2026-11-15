import re, time
from pw_common import BASE
def stepno(c):
    m=re.search(r"STEP (\d) OF 8", c.inner_text("body")); return int(m.group(1)) if m else None
def advance(c, n):
    btn=c.query_selector("button.glass-btn-primary:not([disabled])") or c.query_selector("button:has-text('Grant Permissions')")
    btn.click()
    for _ in range(120):
        c.wait_for_timeout(300)
        if stepno(c)!=n: break
def run_check(c, href, photo="/tmp/imgs/face1.jpg"):
    c.goto(BASE+href); c.wait_for_timeout(2500)
    c.click("text=Grant Permissions"); c.wait_for_timeout(1500)
    for n in (2,3,4,5): advance(c,n)
    # step 6 (profile photo already enrolled -> confirm)
    c.wait_for_timeout(800); advance(c,6)
    c.fill("input[placeholder='I CONSENT']","I CONSENT"); advance(c,7)
    advance(c,8); c.wait_for_timeout(2500)
    return c.url
