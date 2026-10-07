# Lens infrastructure (AWS CDK)

Region `ap-south-1`. One stack, `Lens`:

| Piece | Service | Why |
|---|---|---|
| Media | S3 `lens-media-<account>` (private) | originals at `m/<identityId>/<mediaId>.<ext>` |
| Delivery | CloudFront + signed URLs (key group) | `/m/*` needs a signature; `/*` serves the web viewer |
| API | Lambda (arm64, Node 24) + Function URL | no API Gateway fees |
| Data | DynamoDB `Lens` (on-demand) | identities, tokens, media, shares, contacts, pairing codes |
| Signing key | SSM Parameter Store `/lens/cloudfront/private-key` | free (vs Secrets Manager) |

## Developer access (no access keys)

`aws --profile lens …` gets short-lived credentials through **IAM Roles Anywhere**
using a local CA + client certificate in `~/.aws/rolesanywhere/lens/`.
Set up once with an admin profile: `ADMIN_PROFILE=clashhub ./scripts/setup-roles-anywhere.sh`.
The client certificate is valid for 1 year; re-run the script after deleting
`client.pem`/`client.key` to renew.

## Commands

```bash
npm install
./scripts/cloudfront-keys.sh        # once: CloudFront signing key pair (FORCE=1 to rotate)
./scripts/bootstrap.sh              # once, admin: CDK bootstrap with SetSourceIdentity trust
npm run deploy                      # deploy with the `lens` profile
./scripts/e2e.sh                    # smoke test the live API
```

From the app root, `npm run deploy` builds the web viewer and deploys everything.

## API (`/v1`, bearer token = `<identityId>.<tokenId>.<secret>`)

`POST /devices` · `GET /me` · `GET /users?q=` · `GET /contacts` ·
`POST /media` (start/resume upload) · `GET|POST /media/:id/parts` · `POST /media/:id/complete` ·
`GET /media` · `DELETE /media/:id` · `POST /shares` · `GET /shared` · `DELETE /shared/:owner/:id` ·
`POST /pairing` · `POST /pairing/claim`
