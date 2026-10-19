"""Second "phone" for S8 sharing tests: a guest identity on the live Lens API (like infra/scripts/e2e.sh).

usage: peer.py new NAME_FILE                      create identity, save token/id/name to NAME_FILE
       peer.py upload NAME_FILE ORIG PREVIEW THUMB  upload a photo with derivatives, print media id
       peer.py share NAME_FILE TO_ID MEDIA_ID...    share request, print share id + status
       peer.py get NAME_FILE PATH                   GET an API path as this identity
       peer.py post NAME_FILE PATH [JSON]           POST
"""
import base64, hashlib, json, sys, time, urllib.request

API = "https://bjktkbei62fat72vloceovhn4a0gsxwb.lambda-url.ap-south-1.on.aws/v1"


def req(method, path, token=None, body=None, url=None, data=None, headers=None):
    h = dict(headers or {})
    if token:
        h["authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
        h["content-type"] = "application/json"
    r = urllib.request.Request(url or API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw and raw[:1] in b"{[" else raw)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def md5b64(b):
    return base64.b64encode(hashlib.md5(b).digest()).decode()


def load(f):
    return json.load(open(f))


cmd, f = sys.argv[1], sys.argv[2]
if cmd == "new":
    s, d = req("POST", "/devices", body={"device": "Pixel 8 (S8 test peer)"})
    json.dump(d, open(f, "w"))
    print(s, d.get("id"), d.get("name"))
elif cmd == "upload":
    me = load(f)
    orig, prev, thumb = (open(p, "rb").read() for p in sys.argv[3:6])
    n = int(time.time() * 1000); b36 = ""
    while n: n, r_ = divmod(n, 36); b36 = "0123456789abcdefghijklmnopqrstuvwxyz"[r_] + b36
    mid = f"{b36.rjust(8, '0')}-peer{len(sys.argv[3]) % 10}x"
    s, r = req("POST", "/media", me["token"], {"id": mid, "contentType": "image/jpeg", "size": len(orig), "kind": "photo", "md5": md5b64(orig),
               "derivatives": {"thumb": {"md5": md5b64(thumb), "size": len(thumb)}, "preview": {"md5": md5b64(prev), "size": len(prev)}}})
    assert s in (200, 201), (s, str(r)[:200])
    for key, b in (("thumb", thumb), ("preview", prev)):
        st, _ = req("PUT", "", url=r["derivativeUrls"][key], data=b, headers={"content-type": "image/jpeg", "content-md5": md5b64(b)})
        assert st == 200, (key, st)
    st, _ = req("PUT", "", url=r["url"], data=orig, headers={"content-type": "image/jpeg", "content-md5": md5b64(orig)})
    assert st == 200, ("orig", st)
    s, r = req("POST", f"/media/{mid}/complete", me["token"])
    print(mid, s)
elif cmd == "share":
    me = load(f)
    s, r = req("POST", "/shares", me["token"], {"mediaIds": sys.argv[4:], "to": [sys.argv[3]]})
    print(s, json.dumps(r)[:400])
elif cmd == "get":
    s, r = req("GET", sys.argv[3], load(f)["token"])
    print(s, json.dumps(r)[:3000] if not isinstance(r, bytes) else r[:200])
elif cmd == "post":
    s, r = req("POST", sys.argv[3], load(f)["token"], json.loads(sys.argv[4]) if len(sys.argv) > 4 else None)
    print(s, json.dumps(r)[:1000] if not isinstance(r, bytes) else r[:200])
