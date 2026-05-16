#!/usr/bin/env bash
# scripts/setup-aws.sh
#
# Provisions the AWS infrastructure needed to host the ccaeat PWA:
#   • S3 bucket (private, versioning disabled)
#   • CloudFront distribution with Origin Access Control (OAC)
#   • IAM user + policy with least-privilege deploy permissions
#
# Prerequisites:
#   - AWS CLI v2 installed and configured (aws configure, or env vars)
#   - jq installed
#
# Usage:
#   bash scripts/setup-aws.sh [--bucket <name>] [--region <region>] [--app <label>]
#
# After the script finishes, copy the printed values into your GitHub repository
# secrets: Settings → Secrets and variables → Actions.

set -euo pipefail

# ── Defaults (override with flags) ─────────────────────────────────────────
APP_LABEL="ccaeat"
REGION="us-east-1"
BUCKET_NAME=""   # generated from APP_LABEL if not provided

# ── Parse args ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bucket)  BUCKET_NAME="$2"; shift 2 ;;
    --region)  REGION="$2";      shift 2 ;;
    --app)     APP_LABEL="$2";   shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$BUCKET_NAME" ]]; then
  # Append a short random suffix to avoid global name collisions.
  RAND=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom 2>/dev/null | head -c 8 || true)
  # Fall back to a timestamp-based suffix if urandom is unavailable.
  if [[ -z "$RAND" ]]; then
    RAND=$(date +%s | tail -c 9)
  fi
  BUCKET_NAME="${APP_LABEL}-pwa-${RAND}"
fi

IAM_USER="${APP_LABEL}-deploy"
IAM_POLICY_NAME="${APP_LABEL}-deploy-policy"

# ── Helpers ──────────────────────────────────────────────────────────────────
need() {
  command -v "$1" &>/dev/null || { echo "Error: '$1' is required but not installed." >&2; exit 1; }
}

step() { echo; echo "▶  $*"; }

need aws
need jq

echo "════════════════════════════════════════"
echo "  ccaeat AWS infrastructure setup"
echo "════════════════════════════════════════"
echo "  Bucket : $BUCKET_NAME"
echo "  Region : $REGION"
echo "  IAM    : $IAM_USER"
echo "════════════════════════════════════════"

# ── 1. S3 bucket ─────────────────────────────────────────────────────────────
step "Creating S3 bucket: $BUCKET_NAME"

if [[ "$REGION" == "us-east-1" ]]; then
  aws s3api create-bucket \
    --bucket "$BUCKET_NAME" \
    --region "$REGION" \
    >/dev/null
else
  aws s3api create-bucket \
    --bucket "$BUCKET_NAME" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" \
    >/dev/null
fi

# Block all public access — CloudFront uses OAC, not a public bucket policy.
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
  >/dev/null

echo "  ✓ Bucket created and public access blocked."

# ── 2. CloudFront Origin Access Control ──────────────────────────────────────
step "Creating CloudFront Origin Access Control (OAC)"

OAC_ID=$(aws cloudfront create-origin-access-control \
  --origin-access-control-config \
    "Name=${APP_LABEL}-oac,Description=OAC for ${APP_LABEL} PWA,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
  --query 'OriginAccessControl.Id' \
  --output text)

echo "  ✓ OAC created: $OAC_ID"

# ── 3. CloudFront distribution ───────────────────────────────────────────────
step "Creating CloudFront distribution (this takes ~2 minutes)"

BUCKET_DOMAIN="${BUCKET_NAME}.s3.${REGION}.amazonaws.com"

CF_CONFIG=$(jq -n \
  --arg domain "$BUCKET_DOMAIN" \
  --arg oac    "$OAC_ID" \
  --arg bucket "$BUCKET_NAME" \
  '{
    CallerReference: ("setup-" + (now | tostring)),
    Comment: ("ccaeat PWA – " + $bucket),
    DefaultRootObject: "index.html",
    Origins: {
      Quantity: 1,
      Items: [{
        Id: "s3-origin",
        DomainName: $domain,
        S3OriginConfig: { OriginAccessIdentity: "" },
        OriginAccessControlId: $oac
      }]
    },
    DefaultCacheBehavior: {
      TargetOriginId: "s3-origin",
      ViewerProtocolPolicy: "redirect-to-https",
      CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
      Compress: true,
      AllowedMethods: {
        Quantity: 2,
        Items: ["GET", "HEAD"],
        CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] }
      }
    },
    CustomErrorResponses: {
      Quantity: 1,
      Items: [{
        ErrorCode: 403,
        ResponseCode: "200",
        ResponsePagePath: "/index.html",
        ErrorCachingMinTTL: 0
      }]
    },
    Enabled: true,
    HttpVersion: "http2and3",
    PriceClass: "PriceClass_100"
  }')

CF_OUTPUT=$(aws cloudfront create-distribution \
  --distribution-config "$CF_CONFIG" \
  --query '{id: Distribution.Id, domain: Distribution.DomainName, arn: Distribution.ARN}' \
  --output json)

CF_DIST_ID=$(echo "$CF_OUTPUT" | jq -r '.id')
CF_DOMAIN=$(echo "$CF_OUTPUT"  | jq -r '.domain')
CF_ARN=$(echo "$CF_OUTPUT"     | jq -r '.arn')

echo "  ✓ Distribution created: $CF_DIST_ID  ($CF_DOMAIN)"

# ── 4. Bucket policy – allow CloudFront OAC to read the bucket ───────────────
step "Attaching bucket policy for CloudFront OAC"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

BUCKET_POLICY=$(jq -n \
  --arg bucket "$BUCKET_NAME" \
  --arg cf_arn "$CF_ARN" \
  --arg account "$ACCOUNT_ID" \
  '{
    Version: "2012-10-17",
    Statement: [{
      Sid: "AllowCloudFrontOAC",
      Effect: "Allow",
      Principal: { Service: "cloudfront.amazonaws.com" },
      Action: "s3:GetObject",
      Resource: ("arn:aws:s3:::" + $bucket + "/*"),
      Condition: {
        StringEquals: {
          "aws:SourceArn": $cf_arn
        }
      }
    }]
  }')

aws s3api put-bucket-policy \
  --bucket "$BUCKET_NAME" \
  --policy "$BUCKET_POLICY" \
  >/dev/null

echo "  ✓ Bucket policy applied."

# ── 5. IAM deploy policy ──────────────────────────────────────────────────────
step "Creating IAM policy: $IAM_POLICY_NAME"

DEPLOY_POLICY=$(jq -n \
  --arg bucket "$BUCKET_NAME" \
  --arg cf_dist "$CF_DIST_ID" \
  --arg account "$ACCOUNT_ID" \
  --arg region  "$REGION" \
  '{
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "S3DeployAccess",
        Effect: "Allow",
        Action: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ],
        Resource: [
          ("arn:aws:s3:::" + $bucket),
          ("arn:aws:s3:::" + $bucket + "/*")
        ]
      },
      {
        Sid: "CloudFrontInvalidate",
        Effect: "Allow",
        Action: "cloudfront:CreateInvalidation",
        Resource: ("arn:aws:cloudfront::" + $account + ":distribution/" + $cf_dist)
      }
    ]
  }')

POLICY_ARN=$(aws iam create-policy \
  --policy-name "$IAM_POLICY_NAME" \
  --policy-document "$DEPLOY_POLICY" \
  --query 'Policy.Arn' \
  --output text)

echo "  ✓ Policy created: $POLICY_ARN"

# ── 6. IAM user ───────────────────────────────────────────────────────────────
step "Creating IAM user: $IAM_USER"

aws iam create-user --user-name "$IAM_USER" >/dev/null
aws iam attach-user-policy \
  --user-name "$IAM_USER" \
  --policy-arn "$POLICY_ARN" \
  >/dev/null

echo "  ✓ User created and policy attached."

# ── 7. Access keys ────────────────────────────────────────────────────────────
step "Generating access keys"

KEYS=$(aws iam create-access-key \
  --user-name "$IAM_USER" \
  --query 'AccessKey.{id: AccessKeyId, secret: SecretAccessKey}' \
  --output json)

KEY_ID=$(echo "$KEYS"     | jq -r '.id')
KEY_SECRET=$(echo "$KEYS" | jq -r '.secret')

# ── 8. Print GitHub secrets ───────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
echo "  ✅  Infrastructure ready!  Add these GitHub Actions secrets:"
echo "  Settings → Secrets and variables → Actions → New repository secret"
echo "════════════════════════════════════════════════════════════════"
echo
echo "  AWS_ACCESS_KEY_ID         $KEY_ID"
echo "  AWS_SECRET_ACCESS_KEY     $KEY_SECRET"
echo "  AWS_REGION                $REGION"
echo "  S3_BUCKET                 $BUCKET_NAME"
echo "  CLOUDFRONT_DISTRIBUTION_ID  $CF_DIST_ID"
echo
echo "  CloudFront URL: https://$CF_DOMAIN"
echo "  (Note: the distribution takes ~5 minutes to finish deploying globally.)"
echo "════════════════════════════════════════════════════════════════"
