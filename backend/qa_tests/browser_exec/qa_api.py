import requests, itertools
API="http://127.0.0.1:8000"
def rec_login(email="recruiter1@test.com", pw="Test@1234"):
    r=requests.post(f"{API}/api/auth/login", json={"email":email,"password":pw}); r.raise_for_status(); return r.json()
def new_candidate(email, photo="/tmp/imgs/face1.jpg"):
    with open(photo,"rb") as f:
        r=requests.post(f"{API}/api/auth/register/candidate", data=dict(full_name=email.split("@")[0].title(), email=email, password="Test@1234", college="Test Univ", degree="BTech", graduation_year="2027"), files={"photo":("p.jpg",f,"image/jpeg")})
    r.raise_for_status(); return r.json()
def invite(rec_tok, email, role="QA Engineer"):
    r=requests.post(f"{API}/api/invitations", json={"candidate_email":email,"role_title":role,"duration":30}, headers={"Authorization":"Bearer "+rec_tok}); r.raise_for_status(); return r.json()
def fresh(email):
    new_candidate(email); rt=rec_login(); tok=rt.get("access_token") or rt.get("token")
    inv=invite(tok, email); return tok, inv
