#!/usr/bin/env bash
# Generates the RSA key pair CloudFront uses for signed URLs.
# - Public key  -> infra/keys/cloudfront-public.pem (committed, read by CDK)
# - Private key -> SSM Parameter Store SecureString /lens/cloudfront/private-key
#                  (free tier; read by the API Lambda), local copy in infra/.keys/
# Re-running is a no-op unless FORCE=1 (key rotation).
set -euo pipefail
cd "$(dirname "$0")/.."
PROFILE="${PROFILE:-lens}"
PARAM="/lens/cloudfront/private-key"

if [[ -f keys/cloudfront-public.pem && "${FORCE:-0}" != "1" ]]; then
  echo "Key pair already exists (FORCE=1 to rotate)."
  exit 0
fi

mkdir -p .keys keys && chmod 700 .keys
openssl genrsa -out .keys/cloudfront-private.pem 2048 2>/dev/null
chmod 600 .keys/cloudfront-private.pem
openssl rsa -pubout -in .keys/cloudfront-private.pem -out keys/cloudfront-public.pem 2>/dev/null

aws ssm put-parameter --profile "$PROFILE" --name "$PARAM" --type SecureString \
  --value "file://.keys/cloudfront-private.pem" --overwrite >/dev/null
echo "Stored private key in SSM $PARAM; public key at keys/cloudfront-public.pem"
