# ccaeat

CCA Extemporaneous Apologetics Timer app for iOS and Android (Expo/React Native).

## Features

- **Prep mode**: 5:00 countdown with required audible spoken verbal signals at 4:00, 3:00, 2:00, 1:00, 0:30, and 0:05, plus matching visual prompts.
- **Speaking mode**: 0:00 count-up with required silent visual hand-signal prompts at 1:00, 2:00, 3:00, 4:00, 4:30, and 4:55.
- Prep and speaking cues can **flash the screen** and show a **large visual signal** to get attention without interrupting.
- Start/Pause/Reset controls.
- Portrait and landscape layouts, with a split view in landscape for quick mode switching and an expanded timer.
- Speaking stop-time display to report to judges.

## Run

```bash
npm install
npm run android
# or
npm run ios
```

For local development UI preview:

```bash
npm run start
```

## Deploy

Pushes to `main` run the `Deploy PWA to S3 + CloudFront` workflow.

To enable deployment, provision AWS resources with `bash scripts/setup-aws.sh` and add these GitHub Actions secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `CLOUDFRONT_DISTRIBUTION_ID`

Set `AWS_REGION` as a repository variable or secret if needed. If it is not set, the workflow defaults to `us-east-1`.

If the required deployment secrets are missing, the workflow still builds the web app and skips the AWS deploy steps.
