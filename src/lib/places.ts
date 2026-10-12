// Place labels for Places and the roll's day markers.
import { COUNTRIES } from './countries';

export function countryName(code: string): string {
  return COUNTRIES[code] ?? code;
}

export function placeLine(p: { city: string; region: string; country: string }): string {
  return [p.region && p.region !== p.city ? p.region : '', countryName(p.country)].filter(Boolean).join(', ');
}
