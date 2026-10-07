#!/usr/bin/env bash
# CDK bootstrap with the customized template (needs an admin profile, once).
set -euo pipefail
cd "$(dirname "$0")/.."
npx cdk bootstrap "aws://$(aws sts get-caller-identity --profile "${ADMIN_PROFILE:-clashhub}" --query Account --output text)/${REGION:-ap-south-1}" \
  --profile "${ADMIN_PROFILE:-clashhub}" --template bootstrap/template.yaml
