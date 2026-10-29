# GrowthAnalyst Lambda (docs/growth/growth-engine.md §2): our report code + the Claude Code CLI, which
# writes the weekly analysis with the owner's subscription token (SSM /lens/growth/claude-token);
# mcp.js is its only tool server (growth-mcp.ts: Search Console, live page audits, website code).
# Build context: infra/ (see console-stack.ts). Versions pinned; bump deliberately.
FROM public.ecr.aws/lambda/nodejs:22 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY lambda ./lambda
RUN npx esbuild lambda/console/growth-run.ts --bundle --platform=node --target=node22 --format=cjs --minify --loader:.txt=text --outfile=/out/index.js \
 && npx esbuild lambda/console/growth-mcp.ts --bundle --platform=node --target=node22 --format=cjs --minify --outfile=/out/mcp.js

FROM public.ecr.aws/lambda/nodejs:22
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code@2.1.312 && claude --version
COPY --from=build /out/index.js /out/mcp.js ${LAMBDA_TASK_ROOT}/
CMD ["index.handler"]
