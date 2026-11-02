// Usage rights for content assets (docs/growth/content-engine.md): what a licence lets Lens do in a social
// post, and the credit line it needs. Code decides, never the model. Pure (tests: growth-rights.test.ts).
//   cleared  usable in commercial social posts (with the credit if one is required)
//   review   a manager must look: share-alike, people or brands in the picture, anything not recognised
//   blocked  not for commercial use or no changes allowed (NC / ND), or rights unknown and refused

export type RightsStatus = 'cleared' | 'review' | 'blocked';
export type Rights = {
  status: RightsStatus;
  license: string;
  licenseUrl: string;
  source: string;
  author: string;
  credit: string;
  commercialOk: boolean;
  editsOk: boolean;
  peopleOrBrands: boolean;
  reason: string;
  evidenceKey?: string;
  checkedAt: number;
  checkedBy: string;
  decision?: { status: RightsStatus; note: string; by: string; at: number };
};

/** Licences we recognise, normalised: "CC BY-SA 4.0" → "cc-by-sa". */
export function licenseKey(license: string): string {
  const l = license.toLowerCase().replace(/[_\s]+/g, '-').replace(/creative-commons-/, 'cc-');
  if (/^(own|our-team|made-by-us)$/.test(l)) return 'own';
  if (/cc0|public-?domain|pdm|no-known-copyright|^pd$/.test(l)) return 'public-domain';
  if (/unsplash/.test(l)) return 'unsplash';
  if (/pexels/.test(l)) return 'pexels';
  if (/pixabay/.test(l)) return 'pixabay';
  const cc = /\bcc-?(by(?:-(?:nc|nd|sa))*)/.exec(l) ?? /\b(by(?:-(?:nc|nd|sa))*)-\d/.exec(l);
  if (cc) return `cc-${cc[1]}`;
  return 'unknown';
}

/** The verdict for one asset. `peopleOrBrands`: recognisable people, logos or trademarks are visible. */
export function licenseVerdict(license: string, peopleOrBrands: boolean): { status: RightsStatus; commercialOk: boolean; editsOk: boolean; needsCredit: boolean; reason: string } {
  const k = licenseKey(license);
  if (k === 'own') return { status: peopleOrBrands ? 'review' : 'cleared', commercialOk: true, editsOk: true, needsCredit: false, reason: peopleOrBrands ? 'Made by our team, but people or brands are visible: check you have their OK' : 'Made by our team' };
  if (k.includes('-nc')) return { status: 'blocked', commercialOk: false, editsOk: !k.includes('-nd'), needsCredit: true, reason: 'Non-commercial licence: not allowed in posts that promote Lens' };
  if (k.includes('-nd')) return { status: 'blocked', commercialOk: true, editsOk: false, needsCredit: true, reason: 'No-derivatives licence: we couldn’t crop, add text or brand it' };
  const free = ['public-domain', 'unsplash', 'pexels', 'pixabay'].includes(k);
  if (free || k === 'cc-by' || k === 'cc-by-sa') {
    const needsCredit = k.startsWith('cc-');
    if (peopleOrBrands) return { status: 'review', commercialOk: true, editsOk: true, needsCredit, reason: 'People or brands are visible: free licences don’t include model or trademark releases' };
    if (k === 'cc-by-sa') return { status: 'review', commercialOk: true, editsOk: true, needsCredit, reason: 'Share-alike: our edited version would have to carry the same licence' };
    return { status: 'cleared', commercialOk: true, editsOk: true, needsCredit, reason: needsCredit ? 'Free to use with credit' : 'Free to use' };
  }
  return { status: 'review', commercialOk: false, editsOk: false, needsCredit: true, reason: 'Licence not recognised: check it before use' };
}

/** "Photo: Jane Doe, CC BY 4.0 (https://…)" — what goes in the caption or credits file. */
export function creditLine(author: string, license: string, source: string): string {
  const k = licenseKey(license);
  if (k === 'own') return '';
  const who = author.trim() || 'Unknown author';
  if (k === 'unsplash') return `Photo: ${who} on Unsplash`;
  if (k === 'pexels') return `Photo: ${who} on Pexels`;
  if (k === 'pixabay') return `Image: ${who} on Pixabay`;
  return `${who}, ${license.trim() || 'licence unknown'}${source ? ` (${source})` : ''}`;
}

/** A person's decision overrides the automatic verdict, except that blocked licences stay blocked. */
export function effectiveStatus(r: Pick<Rights, 'status' | 'decision'>): RightsStatus {
  if (!r.decision) return r.status;
  if (r.status === 'blocked' && r.decision.status === 'cleared') return 'blocked';
  return r.decision.status;
}
