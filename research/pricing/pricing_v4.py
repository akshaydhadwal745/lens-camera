import importlib.util, io, contextlib
def load(n):
    s=importlib.util.spec_from_file_location(n,n+'.py'); x=importlib.util.module_from_spec(s)
    with contextlib.redirect_stdout(io.StringIO()): s.loader.exec_module(x)
    return x
m=load('pricing_model'); v=load('pricing_v2'); b=load('pricing_v3'); USD=m.USD
DA=(0.002+0.125*0.025)*USD   # inactive free account: originals Deep Archive, previews hot
def proj(mau, conv, mix, costf, inactive_archive, egress_free=False, play=0.6, welcome_share=0.15):
    payers=mau*conv; welcome=mau*welcome_share; free=mau-payers-welcome
    rev=cost=served=0
    for share,gb,prof,price in mix:
        n=payers*share; p=dict(m.PROFILES[prof]); p['stored']=gb
        rev+=n*(play*m.net(price,'play')+(1-play)*m.net(price,'rzp')); cost+=n*costf(p,False); served+=n*p['served']
    if inactive_archive:   # 40% of free accounts inactive 6+ months → originals to Deep Archive
        cost+=free*0.6*costf(m.FREE,False)+free*0.4*m.FREE['stored']*DA
    else: cost+=free*costf(m.FREE,False)
    cost+=welcome*costf(m.WELCOME,False); served+=free*0.15+welcome*0.3
    if not egress_free: cost+=max(0,served-1000)*m.EGRESS
    cost+=mau*m.PLATFORM_PER_MAU+m.FIXED[mau]
    return payers,rev,cost
plus=[(0.50,15,'typical mixed',59),(0.35,30,'typical mixed',59),(0.15,50,'heavy video',59)]
idea=[(0.50,15,'typical mixed',60),(0.35,30,'typical mixed',60),(0.15,40,'heavy video',60)]
# PAYG ₹3/GB above free 10 GB, more payers
payg=[(s,gb,pr,3*(gb-10)) for s,gb,pr in [(0.55,16,'typical mixed'),(0.30,30,'typical mixed'),(0.12,60,'heavy video'),(0.03,120,'cold archive')]]
# recommended: Plus 50 GB ₹59 + optional +50 GB pack ₹79 (10% of payers take one)
rec=[(0.50,15,'typical mixed',59),(0.30,30,'typical mixed',59),(0.10,50,'heavy video',59),(0.10,85,'heavy video 80',59+79)]
S={'A Your idea 40GB ₹60, S3 today':(idea,m.monthly_cost,False,False),
   'B PAYG ₹3/GB >10GB, S3 today':(payg,m.monthly_cost,False,False),
   'C Plus ₹59 + packs, S3 today':(rec,m.monthly_cost,False,False),
   'D Plus ₹59 + packs + GIR + inactive archive':(rec,v.cost_gir,True,False),
   'E same as D on B2 + free egress':(rec,b.cost_b2,True,True)}
for conv in (0.03,0.06):
    print(f"\n=== {int(conv*100)}% paying (PAYG gets +50%: {conv*150:.1f}%) — monthly ₹")
    print(f"{'scenario':46s}{'MAU':>10s}{'payers':>8s}{'revenue':>12s}{'cost':>12s}{'profit':>12s}")
    for name,(mix,f,ia,ef) in S.items():
        for mau in (1000,10000,100000,1000000):
            c=conv*1.5 if name.startswith('B') else conv
            p,r,co=proj(mau,c,mix,f,ia,ef)
            print(f"{name:46s}{mau:10,d}{p:8,.0f}{r:12,.0f}{co:12,.0f}{r-co:12,.0f}")
