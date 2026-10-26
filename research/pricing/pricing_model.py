"""Lens pricing model: cost per GB, per-user margins, projections at scale.
All money in INR. $1 = 88. AWS ap-south-1 list prices (docs/business/business-model-and-roadmap.md)."""
USD = 88.0
GST = 0.18
RZP_FEE = 0.02 * 1.18      # 2% + 18% GST on the fee
PLAY_FEE = 0.15

# --- storage per GB-month of originals (incl. preview+thumb ~12.5% in Standard) ---
PREV = 0.125 * 0.025       # previews/thumbs in S3 Standard
MON = 0.001                # Intelligent-Tiering monitoring (~250 objs/GB) + versioning overhead
TIER = {'fresh': 0.025, 'mid': 0.0138, 'cold': 0.005}   # <30 d, 30-90 d, >90 d
def gbmo(t): return (TIER[t] + PREV + MON) * USD
BACKUP = 0.002 * USD       # second copy in Glacier Deep Archive (other account), per GB-month
BACKUP_ONCE = 0.0125 * USD # Deep Archive PUT requests (~250 objs/GB), one time
EGRESS = 0.109 * USD       # CloudFront India per GB served (after free 1 TB/month)
VIDEO_PROC = 0.45          # Fargate Spot HLS per GB of video (one time) + stream copy storage amortised
PUT_ONCE = 0.004 * USD     # S3 PUTs on upload, per GB (3 objects per photo)

for t in TIER: print(f"storage {t:5s} ₹{gbmo(t):.2f}/GB-mo")
print(f"backup copy ₹{BACKUP:.2f}/GB-mo, egress ₹{EGRESS:.2f}/GB")

def net(price, channel):
    ex = price / (1 + GST)
    return ex * (1 - PLAY_FEE) if channel == 'play' else ex - price * RZP_FEE
for p in (59, 60, 499 / 12):
    print(f"₹{p:.0f} → razorpay ₹{net(p,'rzp'):.1f}, play ₹{net(p,'play'):.1f}")

# --- usage profiles (steady state, library ~1 year old) ---
# stored GB, new GB/month, served GB/month (previews + streams + downloads), video share of new
PROFILES = {
    'occasional photos': dict(stored=5,   new=0.3, served=0.2, video=0.1),
    'typical mixed':     dict(stored=20,  new=1.5, served=0.6, video=0.4),
    'heavy video':       dict(stored=40,  new=4.0, served=3.0, video=0.8),
    'heavy video 80':    dict(stored=80,  new=5.0, served=4.0, video=0.8),
    'cold archive':      dict(stored=100, new=1.0, served=0.1, video=0.3),
}
def monthly_cost(p, egress_paid=True, backup=True):
    fresh = min(p['new'], p['stored']); mid = min(2 * p['new'], p['stored'] - fresh)
    cold = p['stored'] - fresh - mid
    c = fresh * gbmo('fresh') + mid * gbmo('mid') + cold * gbmo('cold')
    c += p['new'] * (PUT_ONCE + p['video'] * VIDEO_PROC)
    if backup: c += p['stored'] * BACKUP + p['new'] * BACKUP_ONCE
    if egress_paid: c += p['served'] * EGRESS
    return c
print()
for n, p in PROFILES.items():
    c = monthly_cost(p); print(f"{n:18s} {p['stored']:4.0f} GB  cost ₹{c:6.1f}/mo  = ₹{c/p['stored']:.2f}/GB  (storage only ₹{monthly_cost(p,False,False)/p['stored']:.2f}/GB)")

# minimum viable price per GB (break-even, and at 60% gross margin), per channel
print()
for n in ('occasional photos', 'typical mixed', 'heavy video', 'cold archive'):
    cg = monthly_cost(PROFILES[n]) / PROFILES[n]['stored']
    k_r, k_p = net(1, 'rzp'), net(1, 'play')
    print(f"{n:18s} cost ₹{cg:.2f}/GB → break-even rzp ₹{cg/k_r:.2f} play ₹{cg/k_p:.2f}; 60% margin rzp ₹{cg/0.4/k_r:.2f} play ₹{cg/0.4/k_p:.2f}")

# --- fixed 40 GB ₹60: margin per profile ---
print("\nFixed 40 GB ₹60 / Plus 50 GB ₹59 per payer:")
for n in ('occasional photos', 'typical mixed', 'heavy video'):
    p = dict(PROFILES[n]); p['stored'] = min(p['stored'] if n != 'occasional photos' else 15, 40)
    c = monthly_cost(p)
    for ch in ('rzp', 'play'):
        r = net(60, ch); print(f"  {n:18s} {p['stored']:.0f} GB {ch:4s} net ₹{r:.1f} cost ₹{c:.1f} margin {100*(r-c)/r:5.1f}%")

# --- projections ---
# MAU signed-in + guests; free users avg 4 GB stored (capped 10 GB), 0.15 GB served
FREE = dict(stored=4, new=0.4, served=0.15, video=0.3)
WELCOME = dict(stored=9, new=3.0, served=0.3, video=0.4)   # 3-month 40 GB welcome cohort
PLATFORM_PER_MAU = 0.8     # DynamoDB, Lambda, SES, push, Sentry, console
FIXED = {1_000: 3_000, 10_000: 15_000, 100_000: 120_000, 1_000_000: 900_000}  # monthly fixed (domains, tools, support)

def payer_mix(model):
    """returns list of (share, stored GB, profile, monthly price) for payers, and conversion."""
    if model == 'fixed40@60':
        return 0.030, [(0.50, 15, 'typical mixed', 60), (0.35, 30, 'typical mixed', 60), (0.15, 40, 'heavy video', 60)]
    if model == 'plus50@59':
        return 0.030, [(0.50, 15, 'typical mixed', 59), (0.35, 30, 'typical mixed', 59), (0.15, 50, 'heavy video', 59)]
    if model == 'payg@2':   # ₹2/GB above the free 10 GB, from day one; more payers, smaller bills
        out = []
        for share, gb, prof in [(0.55, 16, 'typical mixed'), (0.30, 30, 'typical mixed'), (0.12, 60, 'heavy video'), (0.03, 120, 'cold archive')]:
            out.append((share, gb, prof, 2 * (gb - 10)))
        return 0.045, out
    if model == 'hybrid':   # Plus 50 GB ₹59 + optional 25 GB packs ₹29 (capped), or start at ₹29 "Lite 25 GB"
        return 0.038, [(0.30, 18, 'typical mixed', 29), (0.40, 35, 'typical mixed', 59), (0.20, 50, 'heavy video', 59),
                       (0.10, 80, 'heavy video 80', 59 + 29 * 2)]
    raise KeyError(model)

def project(model, mau, play_share=0.6):
    conv, mix = payer_mix(model)
    payers = mau * conv; free = mau * 0.75 - payers; welcome = mau * 0.25
    served_total = 0; cost = 0; rev = 0
    for share, gb, prof, price in mix:
        n = payers * share; p = dict(PROFILES[prof]); p['stored'] = gb
        cost += n * monthly_cost(p, egress_paid=False); served_total += n * p['served']
        rev += n * (play_share * net(price, 'play') + (1 - play_share) * net(price, 'rzp'))
    for n, p in ((free, FREE), (welcome, WELCOME)):
        cost += n * monthly_cost(p, egress_paid=False); served_total += n * p['served']
    cost += max(0, served_total - 1000) * EGRESS          # 1 TB/month CloudFront free
    cost += mau * PLATFORM_PER_MAU + FIXED[mau]
    return rev, cost, payers

print("\nProjections (monthly, INR, 60% of payers via Play):")
print(f"{'model':12s} {'MAU':>9s} {'payers':>7s} {'revenue':>11s} {'cost':>11s} {'profit':>11s} {'margin':>7s}")
for model in ('fixed40@60', 'plus50@59', 'payg@2', 'hybrid'):
    for mau in FIXED:
        r, c, py = project(model, mau)
        print(f"{model:12s} {mau:9,d} {py:7,.0f} {r:11,.0f} {c:11,.0f} {r-c:11,.0f} {100*(r-c)/r if r else 0:6.0f}%")
