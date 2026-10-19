import sys, subprocess, concurrent.futures as cf, re
keys = [l.split('\t')[0] for l in open(sys.argv[1]) if re.search(r'/(preview|thumb)(-v\d+)?\.jpg\t', l)]
def gps(head):
    # JPEG APP1 Exif with a GPS IFD pointer (0x8825) in IFD0
    i = head.find(b'Exif\x00\x00')
    if i < 0: return False
    t = i + 6; le = head[t:t+2] == b'II'
    u16 = lambda o: int.from_bytes(head[o:o+2], 'little' if le else 'big')
    u32 = lambda o: int.from_bytes(head[o:o+4], 'little' if le else 'big')
    ifd = t + u32(t+4)
    for k in range(u16(ifd)):
        if u16(ifd+2+12*k) == 0x8825: return True
    return False
def check(k):
    r = subprocess.run(['aws','s3api','get-object','--profile','lens','--bucket','lens-media-495026846839','--key',k,'--range','bytes=0-65535','/dev/stdout'], capture_output=True, timeout=60)
    return k, gps(r.stdout)
with cf.ThreadPoolExecutor(8) as ex:
    res = list(ex.map(check, keys))
bad = [k for k, g in res if g]
open(sys.argv[2], 'w').write('\n'.join(bad))
owners = {}
for k in bad: owners[k.split('/')[1]] = owners.get(k.split('/')[1], 0) + 1
print('scanned', len(res), 'with GPS', len(bad), 'accounts', len(owners), sorted(owners.items(), key=lambda x: -x[1])[:8])
