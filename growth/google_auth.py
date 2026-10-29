"""Access tokens for a Google service account key (JWT bearer grant), stdlib + openssl only."""
import base64, json, os, subprocess, tempfile, time, urllib.parse, urllib.request

def _b64(b: bytes) -> bytes:
    return base64.urlsafe_b64encode(b).rstrip(b"=")

def access_token(key_file: str, scopes: list[str]) -> str:
    key = json.load(open(key_file))
    now = int(time.time())
    claims = {"iss": key["client_email"], "scope": " ".join(scopes), "aud": key["token_uri"], "iat": now, "exp": now + 3600}
    unsigned = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()) + b"." + _b64(json.dumps(claims).encode())
    fd, pem = tempfile.mkstemp()
    try:
        os.write(fd, key["private_key"].encode()); os.close(fd)
        sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", pem], input=unsigned, capture_output=True, check=True).stdout
    finally:
        os.unlink(pem)
    body = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": (unsigned + b"." + _b64(sig)).decode()}).encode()
    return json.load(urllib.request.urlopen(key["token_uri"], body))["access_token"]

def call(token: str, method: str, url: str, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read()
            return r.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
