#!/usr/bin/env bash
# ui.sh tap "<text or content-desc>" | ui.sh texts | ui.sh shot <name>
source ~/.local/bin/android-env.sh
D=$(dirname "$0")
dump() { adb shell rm -f /sdcard/u.xml; adb shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1; adb exec-out cat /sdcard/u.xml > "$D/u.xml"; }
case "$1" in
  tap) dump; python3 - "$D/u.xml" "$2" <<'PY'
import re,sys,subprocess
x=open(sys.argv[1],encoding='utf8',errors='replace').read(); want=sys.argv[2]
best=None
for m in re.finditer(r'<node[^>]*?>',x):
    n=m.group(0)
    t=re.search(r' text="([^"]*)"',n); c=re.search(r'content-desc="([^"]*)"',n); b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n)
    if not b: continue
    for v in (t.group(1) if t else '', c.group(1) if c else ''):
        if v==want or (best is None and want.lower() in v.lower() and v):
            best=[int(g) for g in b.groups()]
            if v==want: break
    else: continue
    if best and (t and t.group(1)==want or c and c.group(1)==want): break
if not best: sys.exit(f"not found: {want}")
cx,cy=(best[0]+best[2])//2,(best[1]+best[3])//2
subprocess.run(['adb','shell','input','swipe',str(cx),str(cy),str(cx),str(cy),'120']); print('tapped',want,cx,cy)
PY
  ;;
  texts) dump; python3 -c "
import re,sys
x=open('$D/u.xml',encoding='utf8',errors='replace').read()
out=[]
for m in re.finditer(r'<node[^>]*?>',x):
    n=m.group(0)
    for k in (' text','content-desc'):
        v=re.search(k+r'=\"([^\"]*)\"',n)
        if v and v.group(1) and v.group(1) not in out: out.append(v.group(1))
print(' | '.join(out)[:1500])" ;;
  shot) adb exec-out screencap -p > "$D/$2.png"; ~/camera-app/research/.venv/bin/python -c "
from PIL import Image; im=Image.open('$D/$2.png'); im.resize((405,832)).save('$D/$2-s.png')" ;;
esac
