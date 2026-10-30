// Run: cd infra && npx tsx --test lambda/console/growth-github.test.ts
// The PR path refuses anything but agent/* branches and website source files before calling GitHub.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { EDITABLE, openPullRequest } from './growth-github';

const pr = (branch: string, path: string) => openPullRequest({ token: 't', base: 'abc', branch, files: [{ path, content: 'x' }], title: 't', body: 'b' });

test('only agent/* branches and site/src content files; checked before any network call', async () => {
  await assert.rejects(pr('main', 'site/src/content/pages.ts'), /agent\/\* branches/);
  await assert.rejects(pr('feat/x', 'site/src/content/pages.ts'), /agent\/\* branches/);
  await assert.rejects(pr('agent/opp-x', '.github/workflows/web.yml'), /outside what drafts may change/);
  await assert.rejects(pr('agent/opp-x', 'infra/lib/lens-stack.ts'), /outside what drafts may change/);
  await assert.rejects(pr('agent/opp-x', 'site/src/scripts/beacon.ts'), /outside what drafts may change/);
});

test('the tool server and the PR path use the same editable rule', () => {
  const mcp = readFileSync(join(__dirname, 'growth-mcp.ts'), 'utf8');
  assert.ok(mcp.includes(`export const EDITABLE = ${EDITABLE.toString()};`));
  for (const ok of ['site/src/content/guides.ts', 'site/src/components/Home.astro', 'site/src/pages/[...path].astro', 'site/src/i18n/ui.ts']) assert.ok(EDITABLE.test(ok), ok);
});

test('no merge, delete or force-push code exists in the GitHub module', () => {
  const src = readFileSync(join(__dirname, 'growth-github.ts'), 'utf8');
  assert.doesNotMatch(src, /\/merge|'DELETE'|"DELETE"|force:\s*true|PATCH/);
});
