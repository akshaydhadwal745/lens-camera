"""Strip EXIF/XMP (APP1) from preview/thumb objects that carry GPS. Backs each object up first.

usage: clean_previews.py KEYS_FILE [--apply]
  without --apply: dry run (download, strip, verify, report; nothing written to S3)
Backups: s3://lens-media-495026846839/lab/backup-previews-2026-10-19/<key>
"""
import subprocess, sys, os, tempfile

BUCKET = "lens-media-495026846839"
BACKUP = "lab/backup-previews-2026-10-19/"
apply = "--apply" in sys.argv
keys = [k.strip() for k in open(sys.argv[1]) if k.strip()]


def aws(*a):
    return subprocess.run(["aws", "--profile", "lens", *a], capture_output=True, text=True, timeout=120)


def without_app1(b: bytes) -> bytes:  # same as src/lib/jpeg-meta.ts
    if len(b) < 4 or b[:2] != b"\xff\xd8":
        return b
    keep, pos, removed = [(0, 2)], 2, False
    while pos + 4 <= len(b) and b[pos] == 0xFF:
        m = b[pos + 1]
        if m in (0xDA, 0xD9):
            break
        end = pos + 2 + int.from_bytes(b[pos + 2:pos + 4], "big")
        if end > len(b):
            return b
        if m == 0xE1:
            removed = True
        else:
            keep.append((pos, end))
        pos = end
    if not removed:
        return b
    keep.append((pos, len(b)))
    return b"".join(b[s:e] for s, e in keep)


ok = 0
with tempfile.TemporaryDirectory() as d:
    for k in keys:
        src, dst = os.path.join(d, "in.jpg"), os.path.join(d, "out.jpg")
        r = aws("s3api", "get-object", "--bucket", BUCKET, "--key", k, src)
        if r.returncode:
            print("GET failed", k, r.stderr[:200]); continue
        meta = aws("s3api", "head-object", "--bucket", BUCKET, "--key", k, "--query", "[ContentType,CacheControl,StorageClass]", "--output", "text").stdout.split()
        b = open(src, "rb").read()
        out = without_app1(b)
        if out == b or b"GPS" in out[:4096] or out[:2] != b"\xff\xd8":
            print("SKIP (nothing to strip or check failed)", k); continue
        open(dst, "wb").write(out)
        if not apply:
            print(f"dry-run {k}: {len(b)} -> {len(out)} bytes"); ok += 1; continue
        if aws("s3", "cp", "--quiet", f"s3://{BUCKET}/{k}", f"s3://{BUCKET}/{BACKUP}{k}").returncode:
            print("BACKUP failed, not touching", k); continue
        ct = meta[0] if meta and meta[0] != "None" else "image/jpeg"
        args = ["s3", "cp", "--quiet", dst, f"s3://{BUCKET}/{k}", "--content-type", ct]
        if len(meta) > 1 and meta[1] != "None":
            args += ["--cache-control", meta[1]]
        if len(meta) > 2 and meta[2] != "None":
            args += ["--storage-class", meta[2]]
        r = aws(*args)
        print(("cleaned " if not r.returncode else "PUT failed ") + k)
        ok += not r.returncode
print(("applied" if apply else "dry run"), ok, "of", len(keys))
