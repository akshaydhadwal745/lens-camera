#!/usr/bin/env python3
"""Builds test-results/dev-N/REPORT.md from what scripts/test-all.sh collected.

One verdict per part (release, phones, screens, API, website), then every
failure and warning with its phone, then the full per-phone self-test lists.

Usage: scripts/test-report.py <build number> <results dir>
"""
import importlib.util
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("summary", HERE / "testlab-summary.py")
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


def read(path: Path) -> str:
    return path.read_text(errors="replace") if path.exists() else ""


def status(out: Path, part: str) -> str:
    return read(out / f"{part}.status").strip() or "skipped"


def matrix_lines(log: str) -> list[str]:
    """testlab.sh's per-phone outcome lines + any gcloud error (quota, bad model …)."""
    keep = []
    for line in log.splitlines():
        if line.startswith("matrix ") or re.match(r"\s+\S+/\S+: ", line) or "ERROR" in line or "QUOTA" in line or "Reason" in line:
            keep.append(line.rstrip())
    return keep


def phone_results(root: Path):
    """[(phone, self-test result or None, crashes)] for one Test Lab results folder."""
    if not root.exists():
        return []
    rows = []
    for d, r in summary.phones(root):
        rows.append((d.name, r, summary.crashes(d)))
    return rows


def main():
    n, out = sys.argv[1], Path(sys.argv[2])
    lines = [f"# Lens dev-{n} — full test report", ""]
    problems = []  # (part, text)

    # 1. release
    rel = read(out / "release.log")
    rel_status = status(out, "release")
    if rel_status == "fail":
        problems.append(("release", (rel.strip().splitlines() or ["verify-release failed"])[-1]))

    # 2. phones (self-test)
    phones = phone_results(out / "phones")
    phone_rows = []
    for name, r, bad in phones:
        for c in bad:
            problems.append((f"phone {name}", c))
        if not r:
            problems.append((f"phone {name}", "no self-test result (didn't finish: see video.mp4 / logcat)"))
            phone_rows.append(f"| {name} | – | – | – | {len(bad)} |")
            continue
        for s in r["steps"]:
            if s["status"] in ("fail", "warn"):
                problems.append((f"phone {name}", f"{s['status'].upper()} {s['label']}: {s.get('message') or ''}".rstrip(": ")))
        phone_rows.append(f"| {name} | {r['passed']} | {r.get('warnings', 0)} | {r['failed']} | {len(bad)} |")
    phones_log = matrix_lines(read(out / "phones.log"))
    if status(out, "phones") == "error":
        problems.append(("phones", "Test Lab run failed to start/finish: " + " / ".join(l for l in phones_log if "ERROR" in l or "QUOTA" in l)[:300]))

    # 3. robo (screens)
    robo = phone_results(out / "robo")
    robo_rows = []
    for name, _, bad in robo:
        shots = len(list((out / "robo" / name).rglob("*.png")))
        for c in bad:
            problems.append((f"screens {name}", c))
        robo_rows.append(f"| {name} | {shots} | {len(bad)} |")
    robo_log = matrix_lines(read(out / "robo.log"))
    for l in robo_log:
        if re.search(r": (?!FINISHED)\w+", l) and re.match(r"\s+\S+/\S+: ", l):
            problems.append(("screens", l.strip()))
    if status(out, "robo") == "error":
        problems.append(("screens", "Robo run failed to start/finish: " + " / ".join(l for l in robo_log if "ERROR" in l or "QUOTA" in l)[:300]))

    # 4. api
    api = read(out / "api.log")
    api_ok = len(re.findall(r"^✔", api, re.M))
    for l in re.findall(r"^✘.*$", api, re.M):
        problems.append(("api", l))
    if status(out, "api") == "fail" and not re.search(r"^✘", api, re.M):
        last = [l for l in api.strip().splitlines() if l and not l.startswith("✔")][-3:]
        problems.append(("api", f"stopped after {api_ok} checks: " + " | ".join(last)))

    # 5. website
    web = read(out / "website.log")
    for l in re.findall(r"^✘.*$", web, re.M):
        problems.append(("website", l))

    def verdict(part, prefix, extra=""):
        """part: the .status file; prefix: how its problems are labelled."""
        s = status(out, part)
        mine = [p for p in problems if p[0].startswith(prefix)]
        if s == "skipped":
            return "– skipped"
        if s in ("fail", "error") or any(not t.startswith("WARN") for _, t in mine):
            return f"✗ problems{extra}"
        if mine:
            return f"! warnings only{extra}"
        return f"✓ pass{extra}"

    lines += [
        "| Part | Result |",
        "|---|---|",
        f"| Release (APK, OTA, signed update, runtime) | {verdict('release', 'release')} |",
        f"| Real phones: in-app self-test ({len(phones)} phones) | {verdict('phones', 'phone')} |",
        f"| Screens: Robo crawl ({len(robo)} virtual phones) | {verdict('robo', 'screens')} |",
        f"| API end-to-end | {verdict('api', 'api', f' ({api_ok} checks ✔)')} |",
        f"| Website | {verdict('website', 'website')} |",
        "",
    ]
    fails = [p for p in problems if not p[1].startswith("WARN")]
    warns = [p for p in problems if p[1].startswith("WARN")]
    lines.append(f"## Failures ({len(fails)})")
    lines += [f"- **{part}**: {text}" for part, text in fails] or ["none"]
    lines += ["", f"## Warnings ({len(warns)})"]
    lines += [f"- **{part}**: {text}" for part, text in warns] or ["none"]

    lines += ["", "## Real phones", "| Phone | pass | warn | fail | crashes |", "|---|---|---|---|---|", *phone_rows, ""]
    lines += ["```", *phones_log, "```"] if phones_log else []
    lines += ["", "## Screens (Robo)", "| Phone | screenshots | crashes |", "|---|---|---|", *robo_rows, ""]
    lines += ["```", *robo_log, "```"] if robo_log else []
    lines += ["", "## Release", "```", *rel.strip().splitlines()[-8:], "```"]
    lines += ["", "## Website", "```", *[l for l in web.splitlines() if not l.startswith("latest.json")], "```"]

    # Every step of every phone, for the record.
    lines += ["", "## Self-test steps per phone"]
    for name, r, _ in phones:
        if not r:
            continue
        lines += ["", f"### {name}"]
        for s in r["steps"]:
            msg = f" — {s['message']}" if s.get("message") else ""
            lines.append(f"- {summary.MARK[s['status']]} {s['label']}{msg}")

    report = "\n".join(lines) + "\n"
    (out / "REPORT.md").write_text(report)
    print(report)
    print(f"→ {out / 'REPORT.md'}")


if __name__ == "__main__":
    main()
