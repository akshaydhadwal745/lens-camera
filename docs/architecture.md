# Architecture

```
 Phone (Expo / React Native)                    AWS ap-south-1 (CDK stack "Lens")
 ───────────────────────────                    ────────────────────────────────
 Pro camera (Swift, AVFoundation, Core Image)
 Imaging engine (looks, edits, export)
 Local store: originals + thumb/preview files
 Upload queue (resumable, MD5-verified) ─────►  Lambda Function URL  ── DynamoDB "Lens"
   presigned PUTs, direct to S3 ─────────────►  S3 lens-media-<account>
                                                   m/{owner}/{id}.{ext}   originals (Intelligent-Tiering)
                                                   d/{owner}/{id}/thumb[-vN].jpg, preview[-vN].jpg
 Gallery / viewer / web  ◄── signed URLs ──────  CloudFront  (m/*, d/* signed; /* web viewer)
```

## Principles

1. Originals are immutable and never re-encoded; edits are recipes.
2. Bytes never pass through the API: phones upload straight to S3 with
   presigned URLs (MD5 signed in) and download through CloudFront.
3. Light work on the phone (thumbnails, previews, looks on the GPU); heavy
   video work in the cloud only when needed (planned, lazy).
4. Cost-first: Lambda Function URL (no API Gateway), DynamoDB on-demand,
   SSM Parameter Store for the signing key, no VPC/NAT, 7-day logs.

## Data model (DynamoDB single table `Lens`)

| Item | pk | sk | Notes |
|---|---|---|---|
| Profile | `D#{id}` | `PROFILE` | name, usedBytes; `gsi1` NAME/name for search |
| Name reservation | `N#{name}` | `NAME` | uniqueness |
| Token | `D#{id}` | `T#{tokenId}` | sha256(secret), label device/web |
| Media | `D#{owner}` | `M#{mediaId}` | key, kind, size, status pending/ready, uploadId, partSize, storageClass, previewReady, edit, derivVersion; when deleted: deletedAt, archived, recoveringSince, gsi1 `TRASH`/`{deletedAt}#{owner}#{id}`; ownerHidden ("only for me") |
| Share | `D#{recipient}` | `S#{mediaId}#{owner}` | gsi1 `SM#{owner}#{mediaId}` for cascade delete |
| Contact | `D#{me}` | `C#{other}` | share history (both directions) |
| Pairing code | `P#{code}` | `PAIR` | TTL 5 min |

Media ids are client-generated and time-sortable (`<base36 ms>-<random>`).

## API (`/v1`, `Authorization: Bearer <id>.<tokenId>.<secret>`)

| Route | Purpose |
|---|---|
| `POST /devices` | Create identity (public) |
| `GET /me` | Profile, usage, quota |
| `POST /media` | Start/resume upload: `{id, kind, contentType, size, md5?, derivatives?, edit?}` → single or multipart plan + derivative URLs |
| `GET/POST /media/:id/parts` | Uploaded parts (resume) / presigned part URLs with MD5 |
| `POST /media/:id/previews` | Verify thumb+preview → item visible everywhere |
| `POST /media/:id/complete` | Verify original (sizes/parts) → ready |
| `POST /media/:id/edit`, `/edit/commit` | New edit: upload re-rendered previews as version N, then switch |
| `GET /media` | List (ready or preview-ready, not deleted/hidden) |
| `DELETE /media/:id?scope=everyone\|me` | To Trash (shared items need a scope: 409 `code: shared`); unfinished uploads are deleted outright |
| `GET /trash`, `POST /media/:id/restore`, `DELETE /media/:id/forever` | Trash/Archive list, restore or recover (~12 h), permanent delete (all versions) |
| `GET /users?q=`, `GET /contacts` | Find people, share history |
| `POST /shares`, `GET /shared`, `DELETE /shared/:owner/:id` | Sharing |
| `POST /pairing`, `POST /pairing/claim` | Web viewer sign-in code |

## Security

S3 blocks public access; CloudFront reads it via Origin Access Control and only
serves `m/*`/`d/*` with signed URLs (RSA key in SSM). Presigned upload URLs are
scoped to one object/part and expire in 1 h. Tokens are stored hashed.
Developers use keyless IAM Roles Anywhere access; CI uses only GitHub-owned
actions pinned by SHA.

## Cost model (monthly, approximate)

| Scale | Storage (Intelligent-Tiering) | Delivery | Total |
|---|---|---|---|
| 10 TB | ~$135 | ~$0 (CloudFront free tier) | ~$150 |
| 100 TB | ~$1,350 | ~$450 pay-as-you-go, $15 flat-rate | ~$1,000–1,450 |
| 1 PB | ~$13,000 | $15–200 flat-rate | ~$8,000–14,000 |

Plan: pay-as-you-go now; CloudFront flat-rate Pro ($15/mo, 50 TB) once there's
an audience. Budget alert at $10/month while testing.
