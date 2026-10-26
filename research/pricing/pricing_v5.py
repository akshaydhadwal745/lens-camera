import importlib.util, io, contextlib
def load(n):
    s=importlib.util.spec_from_file_location(n,n+'.py'); x=importlib.util.module_from_spec(s)
    with contextlib.redirect_stdout(io.StringIO()): s.loader.exec_module(x)
    return x
m=load('pricing_model'); v=load('pricing_v2'); b=load('pricing_v3'); q=load('pricing_v4')
rec=q.rec
def run(label, costf, free, welcome, inactive, conv, ads=0.0, egress_free=False, mau=100000, wshare=0.15):
    M=q.m; old=(dict(M.FREE),dict(M.WELCOME)); M.FREE.update(free); M.WELCOME.update(welcome)
    p,r,c=q.proj(mau,conv,rec,costf,inactive,egress_free,welcome_share=wshare)
    r+=ads*(mau-p); M.FREE.clear(); M.FREE.update(old[0]); M.WELCOME.clear(); M.WELCOME.update(old[1])
    print(f"{label:70s} rev ₹{r:>10,.0f} cost ₹{c:>10,.0f} profit ₹{r-c:>10,.0f} ({100*(r-c)/r:4.0f}%)")
print("100k MAU, monthly:")
F4=dict(stored=4,new=0.4,served=0.15,video=0.3); W40=dict(stored=9,new=3.0,served=0.3,video=0.4)
F2=dict(stored=2,new=0.2,served=0.15,video=0.3); W20=dict(stored=6,new=2.0,served=0.3,video=0.4)
run("today: 10GB free, 40GB welcome, S3, 3%",m.monthly_cost,F4,W40,False,0.03)
run("D: + Glacier IR + inactive archive, 3%",v.cost_gir,F4,W40,True,0.03)
run("D, 6% paying",v.cost_gir,F4,W40,True,0.06)
run("D + free 5GB (avg 2GB) + welcome 20GB/1 month, 5%",v.cost_gir,F2,W20,True,0.05,wshare=0.08)
run("D + free 5GB + welcome 20GB/1mo + ads ₹1.5/free user, 5%",v.cost_gir,F2,W20,True,0.05,ads=1.5,wshare=0.08)
run("E (B2) + 10GB free + 40GB welcome, 5%",b.cost_b2,F4,W40,True,0.05,egress_free=True)
run("E (B2) + free 5GB + welcome 20GB/1mo, 5%",b.cost_b2,F2,W20,True,0.05,egress_free=True,wshare=0.08)
run("E (B2) + free 5GB + welcome 20GB/1mo + ads ₹1.5, 5%",b.cost_b2,F2,W20,True,0.05,ads=1.5,egress_free=True,wshare=0.08)
run("E (B2) + free 5GB + welcome 20GB/1mo + ads ₹1.5, 8%",b.cost_b2,F2,W20,True,0.08,ads=1.5,egress_free=True,wshare=0.08)
run("previews-only free (originals → own Drive), S3+GIR, 3%",v.cost_gir,dict(stored=0.4,new=0.04,served=0.15,video=0.3),W20,True,0.03,wshare=0.08)
run("previews-only free (originals → own Drive), S3+GIR, 5%",v.cost_gir,dict(stored=0.4,new=0.04,served=0.15,video=0.3),W20,True,0.05,wshare=0.08)
