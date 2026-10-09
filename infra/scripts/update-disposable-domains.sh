#!/usr/bin/env bash
# Refreshes the disposable / temporary email domain blocklist used by email
# sign-in (infra/lambda/api/data/disposable-domains.txt). Union of three
# maintained lists; the big auto-generated 96k list is skipped (more false
# positives). Mainstream providers are always allowed (SAFE below). Re-run occasionally, then deploy.
set -euo pipefail
OUT="$(dirname "$0")/../lambda/api/data/disposable-domains.txt"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
get() { curl -sfL --retry 3 --connect-timeout 10 --max-time 60 "$1"; }
get https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf > "$TMP/1"
get https://raw.githubusercontent.com/7c/fakefilter/main/txt/data.txt > "$TMP/2"
get https://raw.githubusercontent.com/wesbos/burner-email-providers/master/emails.txt > "$TMP/3"
SAFE="gmail.com googlemail.com outlook.com hotmail.com live.com msn.com yahoo.com yahoo.co.in ymail.com icloud.com me.com mac.com
proton.me protonmail.com pm.me zoho.com zohomail.in rediffmail.com aol.com gmx.com gmx.net mail.com yandex.com yandex.ru tutanota.com
tuta.io fastmail.com hey.com instagrowapp.com"
printf '%s\n' $SAFE > "$TMP/allow"
norm() { grep -v '^#' | tr 'A-Z' 'a-z' | tr -d '\r \t' | grep -E '^[a-z0-9.-]+\.[a-z]{2,}$' | sort -u; }
for n in 1 2 3; do [[ $(wc -l < "$TMP/$n") -gt 1000 ]] || { echo "source $n looks broken"; exit 1; }; done
cat "$TMP/1" "$TMP/2" "$TMP/3" | norm > "$TMP/union"
norm < "$TMP/allow" > "$TMP/allowed"
mkdir -p "$(dirname "$OUT")"
comm -23 "$TMP/union" "$TMP/allowed" > "$OUT"
echo "$(wc -l < "$OUT") disposable domains → $OUT"
