// Help page: filter questions as you type, and open a question linked by #id.
// Without JavaScript every question is still listed.
const form = document.querySelector<HTMLFormElement>('[data-help-search]');
const input = form?.querySelector('input');
const groups = [...document.querySelectorAll<HTMLElement>('[data-help-group]')];
const topics = document.querySelector<HTMLElement>('[data-help-topics]');
const empty = document.querySelector<HTMLElement>('[data-help-empty]');

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
const items = groups.flatMap((g) =>
  [...g.querySelectorAll<HTMLDetailsElement>('[data-help-item]')].map((el) => ({ el, group: g, text: norm(el.textContent ?? '') })),
);

function filter(query: string) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  let shown = 0;
  for (const it of items) {
    const hit = words.every((w) => it.text.includes(w));
    it.el.hidden = !hit;
    if (hit) shown++;
  }
  for (const g of groups) g.hidden = !items.some((it) => it.group === g && !it.el.hidden);
  if (topics) topics.hidden = searching;
  if (empty) empty.hidden = shown > 0;
}

input?.addEventListener('input', () => filter(input.value));
// /help/?q=flash opens the page already filtered (handy in support replies).
const preset = new URLSearchParams(location.search).get('q');
if (input && preset) {
  input.value = preset;
  filter(preset);
}
form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const first = items.find((it) => !it.el.hidden);
  if (first) {
    first.el.open = true;
    first.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const el = id ? document.getElementById(id) : null;
  if (el instanceof HTMLDetailsElement) {
    el.open = true;
    el.scrollIntoView({ block: 'center' });
  }
}
window.addEventListener('hashchange', openFromHash);
openFromHash();
