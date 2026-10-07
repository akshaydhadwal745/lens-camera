#!/usr/bin/env bash
# One-time bootstrap: keyless developer access via IAM Roles Anywhere.
#
# Creates a local CA + client certificate, registers the CA as a Roles Anywhere
# trust anchor, creates the `lens-developer` role and a Roles Anywhere profile,
# then adds a `lens` profile to ~/.aws/config that uses the signing helper.
#
# Usage: ADMIN_PROFILE=clashhub ./setup-roles-anywhere.sh
set -euo pipefail

ADMIN_PROFILE="${ADMIN_PROFILE:-clashhub}"
REGION="${REGION:-ap-south-1}"
CLI_PROFILE="${CLI_PROFILE:-lens}"
ROLE_NAME="lens-developer"
CLIENT_CN="${CLIENT_CN:-$(whoami)-$(hostname -s)}"
DIR="$HOME/.aws/rolesanywhere/lens"
HELPER="$HOME/.local/bin/aws_signing_helper"
HELPER_VERSION="1.8.5"
HELPER_SHA256="beec9ed1c492d93db809890f16713e3556353294b823c2184ad4e891f1b2b54d"

aws_admin() { aws --profile "$ADMIN_PROFILE" --region "$REGION" "$@"; }

ACCOUNT=$(aws_admin sts get-caller-identity --query Account --output text)
echo "Account: $ACCOUNT  Region: $REGION  Client CN: $CLIENT_CN"

# ---- 1. Signing helper ----
if [[ ! -x "$HELPER" ]]; then
  mkdir -p "$(dirname "$HELPER")"
  curl -fsSL -o "$HELPER" \
    "https://rolesanywhere.amazonaws.com/releases/${HELPER_VERSION}/X86_64/Linux/Amzn2023/aws_signing_helper"
  echo "${HELPER_SHA256}  ${HELPER}" | sha256sum -c -
  chmod +x "$HELPER"
fi

# ---- 2. Local CA + client certificate ----
mkdir -p "$DIR" && chmod 700 "$DIR"
cd "$DIR"
if [[ ! -f ca.key ]]; then
  openssl ecparam -name prime256v1 -genkey -noout -out ca.key
  openssl req -x509 -new -key ca.key -sha256 -days 3650 -out ca.pem \
    -subj "/O=Lens/OU=Dev/CN=Lens Dev CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash"
fi
if [[ ! -f client.key ]]; then
  openssl ecparam -name prime256v1 -genkey -noout -out client.key
  openssl req -new -key client.key -out client.csr -subj "/O=Lens/CN=${CLIENT_CN}"
  cat > client.ext <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
EXT
  openssl x509 -req -in client.csr -CA ca.pem -CAkey ca.key -CAcreateserial \
    -out client.pem -days 365 -sha256 -extfile client.ext
  rm -f client.csr client.ext
fi
chmod 600 ca.key client.key

# ---- 3. Trust anchor ----
TA_ARN=$(aws_admin rolesanywhere list-trust-anchors \
  --query "trustAnchors[?name=='lens-dev-ca'].trustAnchorArn | [0]" --output text)
if [[ "$TA_ARN" == "None" || -z "$TA_ARN" ]]; then
  TA_ARN=$(aws_admin rolesanywhere create-trust-anchor --name lens-dev-ca --enabled \
    --source "sourceType=CERTIFICATE_BUNDLE,sourceData={x509CertificateData=$(cat ca.pem)}" \
    --query trustAnchor.trustAnchorArn --output text)
fi
echo "Trust anchor: $TA_ARN"

# ---- 4. Role ----
cat > /tmp/lens-trust.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "rolesanywhere.amazonaws.com" },
    "Action": ["sts:AssumeRole", "sts:TagSession", "sts:SetSourceIdentity"],
    "Condition": {
      "StringEquals": { "aws:PrincipalTag/x509Issuer/CN": "Lens Dev CA" },
      "ArnEquals": { "aws:SourceArn": "${TA_ARN}" }
    }
  }]
}
JSON
if aws_admin iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws_admin iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document file:///tmp/lens-trust.json
else
  aws_admin iam create-role --role-name "$ROLE_NAME" --max-session-duration 14400 \
    --description "Lens developer access via IAM Roles Anywhere" \
    --assume-role-policy-document file:///tmp/lens-trust.json >/dev/null
fi
rm -f /tmp/lens-trust.json

aws_admin iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess

cat > /tmp/lens-dev-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CdkDeployViaBootstrapRoles",
      "Effect": "Allow",
      "Action": ["sts:AssumeRole", "sts:TagSession", "sts:SetSourceIdentity"],
      "Resource": "arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-*"
    },
    {
      "Sid": "LensParameters",
      "Effect": "Allow",
      "Action": [
        "ssm:PutParameter", "ssm:GetParameter", "ssm:DeleteParameter", "ssm:AddTagsToResource"
      ],
      "Resource": "arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/lens/*"
    },
    {
      "Sid": "LensDataDebug",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
        "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload",
        "logs:StartQuery", "logs:GetQueryResults", "logs:StartLiveTail"
      ],
      "Resource": [
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/Lens*",
        "arn:aws:s3:::lens-media-*/*",
        "arn:aws:logs:${REGION}:${ACCOUNT}:log-group:*"
      ]
    }
  ]
}
JSON
aws_admin iam put-role-policy --role-name "$ROLE_NAME" --policy-name lens-developer \
  --policy-document file:///tmp/lens-dev-policy.json
rm -f /tmp/lens-dev-policy.json
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}"

# ---- 5. Roles Anywhere profile ----
PROFILE_ARN=$(aws_admin rolesanywhere list-profiles \
  --query "profiles[?name=='lens-developer'].profileArn | [0]" --output text)
if [[ "$PROFILE_ARN" == "None" || -z "$PROFILE_ARN" ]]; then
  PROFILE_ARN=$(aws_admin rolesanywhere create-profile --name lens-developer --enabled \
    --role-arns "$ROLE_ARN" --duration-seconds 3600 \
    --query profile.profileArn --output text)
fi
echo "Profile: $PROFILE_ARN"

# ---- 6. Local CLI profile ----
aws configure set region "$REGION" --profile "$CLI_PROFILE"
aws configure set credential_process \
  "$HELPER credential-process --certificate $DIR/client.pem --private-key $DIR/client.key --trust-anchor-arn $TA_ARN --profile-arn $PROFILE_ARN --role-arn $ROLE_ARN" \
  --profile "$CLI_PROFILE"

echo
echo "Done. Test with: aws sts get-caller-identity --profile $CLI_PROFILE"
