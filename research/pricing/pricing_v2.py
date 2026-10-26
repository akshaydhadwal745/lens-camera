import importlib.util, sys, io, contextlib
spec = importlib.util.spec_from_file_location('m', 'pricing_model.py'); m = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()): spec.loader.exec_module(m)
USD=m.USD
GIR = 0.005; GIR_READ = 0.03*USD   # Glacier Instant Retrieval: per GB-month, per GB read
def cost_gir(p, egress_paid=True, backup=True, read_frac=0.3):
    # originals straight to Glacier IR (90-day minimum), previews hot; reads of originals pay retrieval
    c = p['stored']*(GIR+m.PREV+m.MON)*USD + p['new']*(m.PUT_ONCE + 0.02*USD*0.25 + p['video']*m.VIDEO_PROC)
    c += p['served']*read_frac*GIR_READ
    if backup: c += p['stored']*m.BACKUP + p['new']*m.BACKUP_ONCE
    if egress_paid: c += p['served']*m.EGRESS
    return c
print("Per-profile cost, originals in Glacier IR:")
for n,p in m.PROFILES.items():
    a=m.monthly_cost(p); b=cost_gir(p)
    print(f"  {n:18s} {p['stored']:4.0f} GB  now ₹{a/p['stored']:.2f}/GB  GIR ₹{b/p['stored']:.2f}/GB   (no egress: ₹{cost_gir(p,False)/p['stored']:.2f})")
FREE=m.FREE; WEL=m.WELCOME
for f in (m.monthly_cost, cost_gir):
    print(f"{f.__name__}: free user ₹{f(FREE,False):.2f}/mo, welcome user ₹{f(WEL,False):.2f}/mo (= ₹{3*f(WEL,False):.0f} per sign-up), free 10GB-full ₹{f(dict(stored=10,new=0.3,served=0.2,video=0.3),False):.2f}")

def payer_contrib(model, costf, play=0.6):
    conv, mix = m.payer_mix(model); r=c=0
    for share,gb,prof,price in mix:
        p=dict(m.PROFILES[prof]); p['stored']=gb
        r+=share*(play*m.net(price,'play')+(1-play)*m.net(price,'rzp')); c+=share*costf(p)
    return conv, r, c
print("\nPer payer (60% Play), egress paid:")
for mod in ('fixed40@60','plus50@59','payg@2','hybrid'):
    for f in (m.monthly_cost, cost_gir):
        conv,r,c=payer_contrib(mod,f); print(f"  {mod:11s} {f.__name__:12s} net ₹{r:5.1f} cost ₹{c:5.1f} margin ₹{r-c:6.1f} ({100*(r-c)/r:4.0f}%)")

print("\nBreak-even paying share of active users (steady state: 85% free / 15% in welcome, + ₹0.8 platform/user):")
for mod in ('fixed40@60','plus50@59','payg@2','hybrid'):
    for f in (m.monthly_cost, cost_gir):
        for freegb in (4,2):
            fr=dict(FREE); fr['stored']=freegb; fr['new']=freegb/10
            _,r,c=payer_contrib(mod,f)
            nonpayer = 0.85*f(fr,False)+0.15*f(WEL,False)+0.8
            # payers margin incl platform  (r - c - 0.8)*x = nonpayer*(1-x)
            mg=r-c-0.8
            x = nonpayer/(mg+nonpayer) if mg>0 else float('inf')
            print(f"  {mod:11s} {f.__name__:12s} free avg {freegb} GB: non-payer ₹{nonpayer:4.1f}/mo, payer margin ₹{mg:5.1f} → need {100*x:5.1f}% paying")
