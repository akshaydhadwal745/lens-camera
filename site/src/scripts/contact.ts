// Contact form → POST /api/v1/contact (public; stored + emailed to the team).
const root = document.getElementById('contact')!;
const s: Record<string, string> = JSON.parse(root.dataset.i18n ?? '{}');
const form = document.getElementById('contact-form') as HTMLFormElement;
const status = document.getElementById('contact-status')!;
const topic = form.elements.namedItem('topic') as HTMLSelectElement;
const hint = document.getElementById('delete-hint')!;

const preset = new URLSearchParams(location.search).get('topic');
if (preset && [...topic.options].some((o) => o.value === preset)) topic.value = preset;
const syncHint = () => (hint.hidden = topic.value !== 'delete-account');
topic.addEventListener('change', syncHint);
syncHint();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button')!;
  button.disabled = true;
  status.classList.remove('error');
  status.textContent = s.sending;
  try {
    const res = await fetch('/api/v1/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...data, lang: root.dataset.lang }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? s.error);
    status.textContent = s.sent.replace('{ref}', body.reference).replace('{email}', String(data.email));
    form.reset();
    syncHint();
  } catch (e) {
    status.classList.add('error');
    status.textContent = (e as Error).message || s.error;
  } finally {
    button.disabled = false;
  }
});
