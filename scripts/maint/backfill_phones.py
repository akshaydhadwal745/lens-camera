"""Admin → Phones backfill: phone summaries from the camera capabilities reports already in S3.

usage: python3 -I scripts/maint/backfill_phones.py 2026-10 [--apply]
Reports sent before the app had a monthly phone ID are grouped by phone configuration
(make, model, Android, RAM, chip): the same phone sending reports for several builds
counts once. Dry run by default. Same fields as infra/lambda/api/phones.ts phoneSummary().
"""
import hashlib, json, re, subprocess, sys, time

BUCKET = "lens-media-495026846839"
month = sys.argv[1]
apply = "--apply" in sys.argv
assert re.fullmatch(r"\d{4}-\d{2}", month)


def aws(*a, **kw):
    return subprocess.run(["aws", "--profile", "lens", *a], capture_output=True, text=True, timeout=120, **kw)


def summary(rep, build):
    d = rep.get("device") or {}
    cams = rep.get("cameras") or []
    back = next((c for c in cams if c.get("facing") == "back"), cams[0] if cams else {})
    front = next((c for c in cams if c.get("facing") == "front"), None)
    enc = rep.get("videoEncoders") or {}
    feats = back.get("features") or {}
    out = {
        "manufacturer": (d.get("manufacturer") or "").lower()[:60] or None,
        "model": (d.get("model") or "")[:60] or None,
        "android": str(d.get("android") or "")[:10] or None,
        "api": d.get("api"),
        "ramGB": round(d["ramGB"], 1) if isinstance(d.get("ramGB"), (int, float)) else None,
        "bits64": "arm64-v8a" in (d.get("abis") or []) if d.get("abis") is not None else None,
        "chip": (d.get("soc") or d.get("hardware") or "")[:40] or None,
        "tier": (rep.get("tier") or "")[:20] or None,
        "backLevel": (back.get("level") or "")[:12] or None,
        "backMp": round(back["megapixels"]) if isinstance(back.get("megapixels"), (int, float)) else None,
        "frontMp": round(front["megapixels"]) if front and isinstance(front.get("megapixels"), (int, float)) else None,
        "ois": back.get("ois") is True,
        "flash": back.get("flash") is True,
        "lenses": len(rep["lenses"]) if isinstance(rep.get("lenses"), list) else None,
        "video4k": any((e or {}).get("4k30") for e in enc.values()) and any(re.search(r"2160|uhd|4k", q, re.I) for q in back.get("videoQualities") or []),
        "hdrVideo": len(back.get("hdrVideo") or []) > 0,
        "makerNight": any(re.search("night", e, re.I) for e in back.get("extensions") or []),
        "slowMotion": bool(feats.get("slowMotion")),
        "slowMotionCamera2": bool(feats.get("slowMotionCamera2")),
        "lowLightBoost": feats.get("lowLightBoost") is True,
        "build": str((build or {}).get("code") or (build or {}).get("apk") or "")[:10] or None,
    }
    if isinstance(d.get("concurrentCameras"), bool):
        out["concurrentCameras"] = d["concurrentCameras"]
    return {k: v for k, v in out.items() if v is not None}


keys = [l.split()[-1] for l in aws("s3", "ls", "--recursive", f"s3://{BUCKET}/diag/{month}-").stdout.splitlines() if l.strip()]
phones = {}
for k in keys:
    r = aws("s3", "cp", "--quiet", f"s3://{BUCKET}/{k}", "-")
    try:
        doc = json.loads(r.stdout)
    except ValueError:
        continue
    cap = next((e for e in doc.get("events", []) if e.get("kind") == "capabilities"), None)
    if not cap:
        continue
    s = summary(cap.get("details") or {}, doc.get("build"))
    ident = "|".join(str(s.get(f)) for f in ("manufacturer", "model", "android", "ramGB", "chip"))
    pid = "b" + hashlib.sha256(ident.encode()).hexdigest()[:20]
    at = int(re.search(r"/(\d{13})-", k).group(1)) if re.search(r"/(\d{13})-", k) else int(time.time() * 1000)
    if pid not in phones or at > phones[pid]["at"]:
        phones[pid] = {**s, "at": at}

print(f"{len(keys)} reports, {len(phones)} phones in {month}")
for p in sorted(phones.values(), key=lambda p: p.get("model") or ""):
    print(" ", p.get("manufacturer"), p.get("model"), "Android", p.get("android"), p.get("ramGB"), "GB", p.get("tier"), "build", p.get("build"))
if apply:
    ttl = int(time.time()) + 400 * 86400
    for pid, p in phones.items():
        item = {"pk": {"S": f"PHONES#{month}"}, "sk": {"S": f"P#{pid}"}, "ttl": {"N": str(ttl)}}
        for k, v in p.items():
            item[k] = {"BOOL": v} if isinstance(v, bool) else {"N": str(v)} if isinstance(v, (int, float)) else {"S": str(v)}
        r = aws("dynamodb", "put-item", "--region", "ap-south-1", "--table-name", "Lens", "--item", json.dumps(item))
        if r.returncode:
            print("put failed", pid, r.stderr[:200])
    print("written", len(phones))
