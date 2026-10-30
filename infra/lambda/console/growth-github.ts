// GitHub for the growth agent's drafts (docs/growth/seo-agent.md §2.3, Phase C), through the
// "lens-growth-agent" GitHub App (SSM /lens/growth/github-app: appId, installationId, privateKey).
// Each run gets a 1-hour installation token limited to lens-camera with contents + pull requests.
// This module can create agent/* branches and open pull requests. It has no merge, no branch
// deletion and no push to existing branches: the owner reviews, approves and merges. main requires
// one approval (ruleset protect-main), and GitHub never lets a PR's author approve it.
import { createSign } from 'node:crypto';

import { getParam } from '../api/lib';

export const REPO = 'akshaydhadwal745/lens-camera';
const API = 'https://api.github.com';
const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

type AppKey = { appId: string; installationId?: string; privateKey: string };

export async function githubConfigured(): Promise<boolean> {
  const raw = await getParam('/lens/growth/github-app').catch(() => undefined);
  return !!raw && !!(JSON.parse(raw) as AppKey).installationId;
}

/** A 1-hour token for lens-camera only, with only contents and pull-request write. */
export async function installationToken(): Promise<string> {
  const raw = await getParam('/lens/growth/github-app');
  if (!raw) throw new Error('GitHub App not set up (SSM /lens/growth/github-app)');
  const key = JSON.parse(raw) as AppKey;
  if (!key.installationId) throw new Error('GitHub App is not installed (no installationId)');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: key.appId }))}`;
  const jwt = `${unsigned}.${b64url(createSign('RSA-SHA256').update(unsigned).sign(key.privateKey))}`;
  const r = await call<{ token: string }>(jwt, 'POST', `/app/installations/${key.installationId}/access_tokens`, {
    repositories: [REPO.split('/')[1]],
    permissions: { contents: 'write', pull_requests: 'write' },
  });
  return r.token;
}

async function call<T>(token: string | undefined, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'lens-growth-agent', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${res.status} ${method} ${path}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Only these may change in an agent PR (the same rule edit_file enforces). */
export const EDITABLE = /^site\/src\/(content|components|pages|layouts|i18n)\/[\w\-/.[\]]+\.(ts|astro)$/;

/** A new agent/* branch from `base` with these files, and a pull request into main. */
export async function openPullRequest(o: { token: string; base: string; branch: string; files: { path: string; content: string }[]; title: string; body: string }) {
  if (!/^agent\/[a-z0-9][a-z0-9\-/]{2,80}$/.test(o.branch)) throw new Error(`refusing branch ${o.branch}: agent PRs use agent/* branches`);
  if (!o.files.length) throw new Error('nothing to commit');
  for (const f of o.files) if (!EDITABLE.test(f.path)) throw new Error(`refusing ${f.path}: outside what drafts may change`);
  const repo = `/repos/${REPO}`;
  const baseCommit = await call<{ tree: { sha: string } }>(o.token, 'GET', `${repo}/git/commits/${o.base}`);
  const tree = await call<{ sha: string }>(o.token, 'POST', `${repo}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: o.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  const commit = await call<{ sha: string }>(o.token, 'POST', `${repo}/git/commits`, { message: o.title, tree: tree.sha, parents: [o.base] });
  // Creating a ref fails if the branch exists, so an existing branch is never overwritten.
  await call(o.token, 'POST', `${repo}/git/refs`, { ref: `refs/heads/${o.branch}`, sha: commit.sha });
  const pr = await call<{ html_url: string; number: number }>(o.token, 'POST', `${repo}/pulls`, { title: o.title, head: o.branch, base: 'main', body: o.body, maintainer_can_modify: true });
  return { url: pr.html_url, number: pr.number, branch: o.branch, commit: commit.sha };
}

/** Where a pull request stands (public repo: no token needed). */
export async function pullRequestState(number: number): Promise<'open' | 'merged' | 'closed'> {
  const pr = await call<{ state: string; merged: boolean }>(undefined, 'GET', `/repos/${REPO}/pulls/${number}`);
  return pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed';
}
