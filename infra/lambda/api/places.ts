import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import CITIES from './data/cities.txt';
import { Identity } from './identity';
import { ddb, env, HttpError, json, Req, Res } from './lib';
import { MediaRecord, mediaKey, toClient } from './media';

// Places (docs/design/organise-and-share.md, step 2). The phone sends the GPS
// position it wrote into a photo ("Save location" on); the nearest city comes
// from a bundled GeoNames list (cities ≥ 15,000 people, CC BY 4.0) — no paid
// maps API, and positions never leave our servers. Stored on the media as
// gps (3 decimals ≈ 100 m) + place {city, region, country}; owner only: share
// records don't copy them (shares.ts), so recipients never see where it was.

type City = { name: string; cc: string; region: string; lat: number; lng: number; pop: number };
let grid: Map<string, City[]> | null = null;

const cell = (lat: number, lng: number) => `${Math.floor(lat)},${Math.floor(lng)}`;

function load(): Map<string, City[]> {
  if (grid) return grid;
  grid = new Map();
  for (const line of (CITIES as string).split('\n')) {
    if (!line) continue;
    const [name, cc, region, lat, lng, pop] = line.split('\t');
    const c: City = { name, cc, region, lat: Number(lat), lng: Number(lng), pop: Number(pop) };
    const k = cell(c.lat, c.lng);
    const list = grid.get(k);
    if (list) list.push(c);
    else grid.set(k, [c]);
  }
  return grid;
}

/** Great-circle distance in km. */
function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export type Place = { city: string; region: string; country: string };

/**
 * The place people would name: the biggest city within 6 km (a suburb loses to
 * the city it belongs to), else the nearest within 100 km, else none (sea, desert).
 */
export function nearestPlace(lat: number, lng: number): Place | null {
  const g = load();
  const near: { c: City; d: number }[] = [];
  const latCell = Math.floor(lat);
  const lngCell = Math.floor(lng);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      let x = lngCell + dx;
      if (x < -180) x += 360;
      if (x >= 180) x -= 360;
      for (const c of g.get(`${latCell + dy},${x}`) ?? []) {
        const d = km(lat, lng, c.lat, c.lng);
        if (d <= 100) near.push({ c, d });
      }
    }
  }
  if (!near.length) return null;
  const close = near.filter((n) => n.d <= 6).sort((a, b) => b.c.pop - a.c.pop);
  const pick = close[0] ?? near.sort((a, b) => a.d - b.d)[0];
  return { city: pick.c.name, region: pick.c.region, country: pick.c.cc };
}

/** Validated {lat, lng} from a request, rounded to ~100 m, or undefined. */
export function parseGps(value: unknown): { lat: number; lng: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return undefined;
  return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 };
}

export function placeKey(p: Place): string {
  return `${p.country}|${p.region}|${p.city}`;
}

/**
 * POST /v1/media/places {items: [{id, lat, lng}]}: positions for photos already
 * uploaded (the phone reads them from its own files). Up to 100 per call.
 */
export async function setPlaces(identity: Identity, req: Req): Promise<Res> {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [];
  let updated = 0;
  for (const it of items) {
    if (typeof it?.id !== 'string') continue;
    const gps = parseGps(it);
    if (!gps) continue;
    const place = nearestPlace(gps.lat, gps.lng);
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.table,
          Key: mediaKey(identity.id, it.id),
          UpdateExpression: place ? 'SET gps = :g, place = :p' : 'SET gps = :g REMOVE place',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: { ':g': gps, ...(place ? { ':p': place } : {}) },
        }),
      );
      updated++;
    } catch (e) {
      if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
    }
  }
  return json(200, { updated });
}

async function myLocatedMedia(identity: Identity): Promise<MediaRecord[]> {
  const out: MediaRecord[] = [];
  let key: Record<string, any> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: env.table,
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)',
        FilterExpression: 'attribute_exists(place) AND attribute_not_exists(deletedAt) AND attribute_not_exists(ownerHidden)',
        ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':m': 'M#' },
        ExclusiveStartKey: key,
      }),
    );
    out.push(...((page.Items ?? []) as MediaRecord[]));
    key = page.LastEvaluatedKey;
  } while (key);
  return out;
}

/** GET /v1/places: my photos grouped by place, most recent visit first. */
export async function listPlaces(identity: Identity): Promise<Res> {
  const media = await myLocatedMedia(identity);
  const groups = new Map<string, { place: Place; items: MediaRecord[] }>();
  for (const m of media) {
    const k = placeKey(m.place!);
    const g = groups.get(k);
    if (g) g.items.push(m);
    else groups.set(k, { place: m.place!, items: [m] });
  }
  const places = await Promise.all(
    [...groups.entries()].map(async ([key, g]) => {
      g.items.sort((a, b) => b.createdAt - a.createdAt);
      return { key, ...g.place, count: g.items.length, first: g.items[g.items.length - 1].createdAt, last: g.items[0].createdAt, cover: await toClient(g.items[0]) };
    }),
  );
  places.sort((a, b) => b.last - a.last);
  return json(200, { places });
}

/** GET /v1/places/items?key=: one place's photos, newest first. */
export async function placeItems(identity: Identity, req: Req): Promise<Res> {
  const key = req.query.key;
  if (!key || key.length > 300) throw new HttpError(400, 'Invalid place');
  const media = (await myLocatedMedia(identity)).filter((m) => placeKey(m.place!) === key).sort((a, b) => b.createdAt - a.createdAt);
  return json(200, { items: await Promise.all(media.map((m) => toClient(m))) });
}
