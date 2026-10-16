// How a person is shown (infra/lambda/api/real-names.ts): the name friends know
// them by when they set one ("Riya Sharma"), with the unique Lens name
// (quiet-tiger-8703) underneath; just the Lens name otherwise. Two people may
// share a real name: the Lens name under it tells them apart.
type Named = { name?: string | null; realName?: string | null } | null | undefined;

/** The name to show in a sentence or a title. */
export function who(p: Named, fallback = 'someone'): string {
  return p?.realName || p?.name || fallback;
}

/** The Lens name, shown under a real name (null when the title already is the Lens name). */
export function handleOf(p: Named): string | null {
  return p?.realName && p.name ? p.name : null;
}
