import json, subprocess, sys, time, urllib.request
sha = sys.argv[1]
repo = "akshaydhadwal745/lens-camera"
tok = subprocess.check_output(["gh", "auth", "token"]).decode().strip()
def get(path):
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/{path}", headers={"Authorization": f"Bearer {tok}"})
    return json.load(urllib.request.urlopen(req))
run = None
while True:
    runs = [r for r in get(f"actions/runs?head_sha={sha}")["workflow_runs"] if r["name"] == "App builds"]
    if runs:
        run = runs[0]
        jobs = get(f"actions/runs/{run['id']}/jobs")["jobs"]
        # Stop when the Android jobs + release are done (iOS can lag; not needed for Test Lab).
        need = [j for j in jobs if j["name"].startswith(("android", "release", "ota"))]
        if need and all(j["status"] == "completed" for j in need) and any(j["name"].startswith("release") for j in need):
            print("run", run["run_number"])
            for j in jobs: print(" ", j["name"], j["status"], j["conclusion"])
            break
        if run["status"] == "completed":
            print("run", run["run_number"], run["conclusion"])
            for j in jobs: print(" ", j["name"], j["status"], j["conclusion"])
            break
    time.sleep(45)
