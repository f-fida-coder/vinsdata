# Hostinger Deployment Guide (Frontend Auto Deploy, API Persistent)

## Goal

Push to GitHub main and auto-deploy only frontend files.
The server-side api folder remains on Hostinger and is not overwritten on each push.

## Current Structure

- Local repo contains both frontend and api code.
- GitHub Action deploys dist and .htaccess to Hostinger.
- Hostinger keeps api as a persistent server folder.

## Workflow Used

The workflow file is .github/workflows/deploy-hostinger.yml.

It does this on push to main:
1. npm ci
2. npm run build
3. rsync dist to HOSTINGER_DEPLOY_DIR with --delete
4. Explicitly excludes api/
5. Uploads .htaccess

## Required GitHub Secrets

Set these in GitHub repository settings:

- HOSTINGER_SSH_HOST
- HOSTINGER_SSH_USER
- HOSTINGER_SSH_PORT
- HOSTINGER_SSH_KEY
- HOSTINGER_DEPLOY_DIR

Example HOSTINGER_DEPLOY_DIR:

/home/username/domains/yourdomain.com/public_html

## Build Scripts

- npm run build: frontend only (default)
- npm run build:with-api: optional legacy build that copies api into dist

Use build:with-api only if you intentionally want a bundled snapshot.

## First-Time Setup on Hostinger

1. Upload api once manually to HOSTINGER_DEPLOY_DIR/api.
2. Keep .env on the server (outside git if possible).
3. Confirm api/uploads exists and is writable.

After this, normal pushes should not touch api.

## Verify After Push

1. Open GitHub Actions and confirm deploy-hostinger workflow passed.
2. Check site loads new frontend.
3. Confirm old api endpoints still work.

## Troubleshooting

- Frontend changed but backend broke: verify backend was changed locally but not deployed; this is expected with frontend-only workflow.
- 404 on refresh: ensure .htaccess is present in deploy directory.
- Wrong deploy path: verify HOSTINGER_DEPLOY_DIR secret.
