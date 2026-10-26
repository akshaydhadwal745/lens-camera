import importlib.util, io, contextlib
def load(n):
    s=importlib.util.spec_from_file_location(n,n+'.py'); x=importlib.util.module_from_spec(s)
    with contextlib.redirect_stdout(io.StringIO()): s.loader.exec_module(x)
    return x
m=load('pricing_model'); v=load('pricing_v2'); USD=m.USD
B2=0.006   # Backblaze B2 $/GB-month flat, egress free via CDN partner / up to 3x stored
def cost_b2(p, egress_paid=True, backup=True):
    c=p['stored']*(B2*1.125)*USD + p['new']*(p['video']*m.VIDEO_PROC + 0.1)
    if backup: c+=p['stored']*m.BACKUP + p['new']*m.BACKUP_ONCE
    return c   # egress ~0
print("Cost/GB-mo by profile:  S3 today | S3 + Glacier IR | B2 + free egress")
for n,p in m.PROFILES.items():
    print(f"  {n:18s} ₹{m.monthly_cost(p)/p['stored']:.2f} | ₹{v.cost_gir(p)/p['stored']:.2f} | ₹{cost_b2(p)/p['stored']:.2f}")
print("free user (4 GB) / welcome user per month:", *[f"₹{f(m.FREE,False):.2f}/₹{f(m.WELCOME,False):.2f}" for f in (m.monthly_cost,v.cost_gir,cost_b2)])

plans = {  # name: (price, GB)
 'Your idea 40 GB ₹60':(60,40),'Plus 50 GB ₹59':(59,50),'Max 200 GB ₹149 (defined, not sold)':(149,200),
 'Google One Lite 30 GB ₹59':(59,30),'Google One 100 GB ₹130':(130,100),'Google One 200 GB ₹210':(210,200),'iCloud 50 GB ₹75':(75,50)}
print("\nPrice per GB of capacity:"); [print(f"  {k:36s} ₹{p/g:.2f}/GB") for k,(p,g) in plans.items()]

print("\nPlan margin when FULL (60% Play), S3 today / Glacier IR / B2:")
for k in ('Your idea 40 GB ₹60','Plus 50 GB ₹59','Max 200 GB ₹149 (defined, not sold)'):
    price,gb=plans[k]; r=0.6*m.net(price,'play')+0.4*m.net(price,'rzp')
    prof=dict(m.PROFILES['typical mixed']); prof['stored']=gb; prof['new']=gb/25; prof['served']=gb/30
    out=[f"{100*(r-f(prof))/r:4.0f}%" for f in (m.monthly_cost,v.cost_gir,cost_b2)]
    print(f"  {k:36s} net ₹{r:5.1f}  margins {' / '.join(out)}")
print("\nPAYG: price per GB needed (60% Play) for 0% / 50% / 70% gross margin:")
for n in ('occasional photos','typical mixed','heavy video','cold archive'):
    p=m.PROFILES[n]; k=0.6*m.net(1,'play')+0.4*m.net(1,'rzp')
    for f in (m.monthly_cost,cost_b2):
        cg=f(p)/p['stored']; print(f"  {n:18s} {f.__name__:12s} ₹{cg/k:.2f} / ₹{cg/0.5/k:.2f} / ₹{cg/0.3/k:.2f}")

print("\nAffordable cost per free user at conversion c, given payer margin M: M*c/(1-c)")
for M in (6,20,30):
    print("  M=₹%d:"%M, ", ".join(f"{int(c*100)}% → ₹{M*c/(1-c):.2f}" for c in (0.02,0.03,0.05,0.08)))
