// Place labels for Places and the roll's day markers (country names in the phone's language).

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function placeLine(p: { city: string; region: string; country: string }): string {
  return [p.region && p.region !== p.city ? p.region : '', countryName(p.country)].filter(Boolean).join(', ');
}
