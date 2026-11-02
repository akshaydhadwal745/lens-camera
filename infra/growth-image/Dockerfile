# GrowthAnalyst Lambda (docs/growth/growth-engine.md §2): our report code + the Claude Code CLI, which
# writes the weekly analysis with the owner's subscription token (SSM /lens/growth/claude-token);
# mcp.js is its only tool server (growth-mcp.ts: Search Console, live page audits, website code).
# competitor_page renders JavaScript-only pages in headless Chromium (growth-render.ts): puppeteer-core and
# @sparticuz/chromium stay outside the bundle and are installed next to it at the versions in package.json.
# Build context: infra/ (see console-stack.ts). Versions pinned; bump deliberately.
FROM public.ecr.aws/lambda/nodejs:22 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY lambda ./lambda
RUN npx esbuild lambda/console/growth-run.ts --bundle --platform=node --target=node22 --format=cjs --minify --loader:.txt=text --outfile=/out/index.js \
 && npx esbuild lambda/console/growth-mcp.ts --bundle --platform=node --target=node22 --format=cjs --minify --external:puppeteer-core --external:@sparticuz/chromium --outfile=/out/mcp.js \
 && node -e "const p=require('./package.json');const d={};for(const k of ['puppeteer-core','@sparticuz/chromium'])d[k]=p.dependencies[k];require('fs').writeFileSync('/out/package.json',JSON.stringify({private:true,dependencies:d}))" \
 && cd /out && npm install --omit=dev --ignore-scripts --no-audit --no-fund

FROM public.ecr.aws/lambda/nodejs:22
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code@2.1.312 && claude --version
COPY --from=build /out/index.js /out/mcp.js ${LAMBDA_TASK_ROOT}/
COPY --from=build /out/node_modules ${LAMBDA_TASK_ROOT}/node_modules
CMD ["index.handler"]
