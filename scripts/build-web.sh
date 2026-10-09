#!/usr/bin/env bash
# Builds the whole website into site/dist/:
#   /        Astro marketing site (static HTML, English + Hindi)
#   /app/    the Expo web app (signed-in area; app.json experiments.baseUrl = /app)
set -euo pipefail
cd "$(dirname "$0")/.."

(cd site && npm ci --no-audit --no-fund && npm run build)

rm -rf dist
npx expo export --platform web --output-dir dist
rm -rf site/dist/app
mkdir -p site/dist/app
cp -R dist/. site/dist/app/
echo "website built: $(find site/dist -type f | wc -l) files"
