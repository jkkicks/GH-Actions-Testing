# CI/CD Setup Guide

A portable, step-by-step guide to implementing a full CI/CD pipeline with GitHub Actions, GHCR, Release Please, and GitOps-ready deployment.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Repository Setup](#repository-setup)
5. [Workflow Files](#workflow-files)
6. [Dockerfile](#dockerfile)
7. [Database Migrations](#database-migrations)
8. [GitHub Configuration](#github-configuration)
9. [Testing the Pipeline](#testing-the-pipeline)
10. [Customization Guide](#customization-guide)

---

## Overview

This guide implements a CI/CD pipeline with the following flow:

```
PR Opened → Quality Checks (lint, typecheck, migrations, security)
    ↓
PR Merged to main → Build Docker Image → Security Scan → Deploy to Staging
    +
Release Please opens a Release PR (if feat/fix commits)
    ↓
Release PR Merged → GitHub Release Created (tag: vX.Y.Z)
    ↓
Production Deploy → Retag Image → Deploy to Production
```

### Key Features

- **Automated versioning** via Release Please (Conventional Commits)
- **Security scanning** with Trivy (code + container images)
- **Migration verification** with Drizzle ORM
- **Docker layer caching** for fast builds
- **GitOps-ready** deployment hooks
- **GitHub Environments** for deployment tracking

---

## Architecture

| Component | Technology |
|-----------|------------|
| Source Control | GitHub |
| CI Provider | GitHub Actions |
| Container Registry | GitHub Container Registry (GHCR) |
| Deployment | GitOps (DOCO-CD, ArgoCD, or similar) |
| Database | PostgreSQL with Drizzle ORM |
| Security Scanning | Trivy |
| Versioning | Release Please |

---

## Prerequisites

Before starting, ensure you have:

1. **Node.js 20+** project with `package.json`
2. **Dockerfile** for containerizing your application
3. **Drizzle ORM** configured (or equivalent migration system)
4. **ESLint** and **TypeScript** configured
5. GitHub repository with admin access

### Required npm Scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "build": "your-build-command",
    "start": "your-start-command",
    "prestart": "drizzle-kit migrate",
    "lint": "eslint --ignore-path .gitignore --cache .",
    "typecheck": "tsc",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  }
}
```

The `prestart` script ensures migrations run automatically before the application starts.

---

## Repository Setup

### Directory Structure

Create the following structure in your repository:

```
.github/
├── workflows/
│   ├── pr-checks.yml           # PR quality gates
│   ├── staging-deploy.yml      # Build and deploy to staging
│   ├── release-please.yml      # Automated versioning
│   └── production-deploy.yml   # Production deployment
├── pull_request_template.md    # (optional)
drizzle/                        # Migration files
├── 0000_*.sql
├── 0001_*.sql
drizzle.config.ts               # Drizzle configuration
Dockerfile                      # Multi-stage build
```

---

## Workflow Files

### 1. PR Checks (`.github/workflows/pr-checks.yml`)

This workflow runs on every pull request and enforces quality gates.

```yaml
name: PR Checks

on:
  pull_request:
    types: [opened, synchronize, reopened]

# Cancel in-progress runs for the same branch
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint & Typecheck
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type checking
        run: npm run typecheck

  migrations:
    name: Migration Check
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test_db
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Check for migration drift
        run: |
          # Generate migrations to see if schema has uncommitted changes
          npm run db:generate

          # Fail if new files were generated (schema changed without migration)
          if [ -n "$(git status --porcelain drizzle/)" ]; then
            echo "::error::Schema drift detected! Run 'npm run db:generate' and commit the migration."
            git status drizzle/
            exit 1
          fi
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/test_db

      - name: Test migrations apply cleanly
        run: npm run db:migrate
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/test_db

  security:
    name: Security Scan
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          format: 'table'
          exit-code: '1'
          ignore-unfixed: true
          severity: 'CRITICAL,HIGH'
```

**What this does:**
- **Lint & Typecheck**: Ensures code quality standards
- **Migration Check**: Detects schema drift (uncommitted schema changes) and verifies migrations apply to a fresh database
- **Security Scan**: Scans dependencies for known vulnerabilities

---

### 2. Staging Deploy (`.github/workflows/staging-deploy.yml`)

This workflow builds and deploys to staging when code is pushed to `main`.

```yaml
name: Staging Deploy

on:
  push:
    branches:
      - main
      - master
  workflow_dispatch:

# Cancel in-progress runs for the same branch
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  REGISTRY: ghcr.io

jobs:
  build:
    name: Build & Push Image
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    outputs:
      image_tag: ${{ steps.meta.outputs.tags }}
      sha_tag: sha-${{ github.sha }}
      image_name: ${{ steps.image-name.outputs.name }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set image name to lowercase
        id: image-name
        run: echo "name=${GITHUB_REPOSITORY,,}" >> $GITHUB_OUTPUT

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ steps.image-name.outputs.name }}
          tags: |
            type=raw,value=latest
            type=sha

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64

      - name: Make package public
        run: |
          curl -X PATCH \
            -H "Accept: application/vnd.github+json" \
            -H "Authorization: Bearer ${{ secrets.GITHUB_TOKEN }}" \
            -H "X-GitHub-Api-Version: 2022-11-28" \
            https://api.github.com/user/packages/container/$(echo "${{ github.event.repository.name }}" | tr '[:upper:]' '[:lower:]')/visibility \
            -d '{"visibility":"public"}' || true

  scan:
    name: Security Scan
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
      security-events: write

    steps:
      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: '${{ env.REGISTRY }}/${{ needs.build.outputs.image_name }}:latest'
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '0'

      - name: Upload Trivy scan results to GitHub Security tab
        uses: github/codeql-action/upload-sarif@v4
        if: always() && hashFiles('trivy-results.sarif') != ''
        with:
          sarif_file: 'trivy-results.sarif'

  deploy:
    name: Deploy to Staging
    needs: [build, scan]
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://staging.example.com  # UPDATE: Your staging URL

    steps:
      - name: Deploy notification
        run: |
          echo "## Staging Deployment" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "Image: ${{ env.REGISTRY }}/${{ needs.build.outputs.image_name }}:${{ needs.build.outputs.sha_tag }}" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "Ready for DOCO-CD to pick up the new image tag." >> $GITHUB_STEP_SUMMARY

      # TODO: Add your deployment method here
      # Options:
      # 1. Update infra repo (GitOps)
      # 2. SSH to server and docker pull
      # 3. Call deployment webhook
      # 4. Use cloud provider CLI (AWS, GCP, etc.)
      - name: Placeholder - Update infra repo
        run: |
          echo "In production, this step would update staging/docker-compose.yml in the infra repo"
          echo "with the new image tag: ${{ needs.build.outputs.sha_tag }}"

  summary:
    name: Summary
    needs: [build, scan, deploy]
    runs-on: ubuntu-latest
    if: always()

    steps:
      - name: Generate summary
        run: |
          echo "## Staging Deploy Summary" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "**Image:** ${{ env.REGISTRY }}/${{ needs.build.outputs.image_name }}" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "**Tags:**" >> $GITHUB_STEP_SUMMARY
          echo "- latest" >> $GITHUB_STEP_SUMMARY
          echo "- ${{ needs.build.outputs.sha_tag }}" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "**Security Scan:** ${{ needs.scan.result }}" >> $GITHUB_STEP_SUMMARY
          echo "**Deploy:** ${{ needs.deploy.result }}" >> $GITHUB_STEP_SUMMARY
```

**What this does:**
- **Build**: Creates Docker image with SHA and `latest` tags, uses GHA caching
- **Scan**: Scans the built image and uploads results to GitHub Security tab
- **Deploy**: Placeholder for your deployment method (GitOps, SSH, webhook, etc.)

---

### 3. Release Please (`.github/workflows/release-please.yml`)

This workflow automates versioning and changelog generation.

```yaml
name: Release Please

on:
  push:
    branches:
      - main
      - master

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    name: Release Please
    runs-on: ubuntu-latest

    steps:
      - name: Run Release Please
        uses: googleapis/release-please-action@v4
        with:
          release-type: node
          token: ${{ secrets.RELEASE_TOKEN }}
```

**How it works:**

1. When you merge commits with conventional prefixes, Release Please opens a "Release PR"
2. The Release PR contains version bump in `package.json` and updated `CHANGELOG.md`
3. When you merge the Release PR, a GitHub Release is created with a tag (e.g., `v1.2.0`)

**Conventional Commit Prefixes:**

| Prefix | Version Bump | Example |
|--------|-------------|---------|
| `feat:` | Minor (0.1.0 → 0.2.0) | `feat: add user profile page` |
| `fix:` | Patch (0.1.0 → 0.1.1) | `fix: correct login validation` |
| `feat!:` or `BREAKING CHANGE:` | Major (0.1.0 → 1.0.0) | `feat!: redesign API` |
| `chore:`, `docs:`, `test:`, `ci:` | No release | `chore: update dependencies` |

---

### 4. Production Deploy (`.github/workflows/production-deploy.yml`)

This workflow promotes and deploys when a GitHub Release is published.

```yaml
name: Production Deploy

on:
  release:
    types: [published]

env:
  REGISTRY: ghcr.io

jobs:
  promote-image:
    name: Promote Image to Production
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    outputs:
      version_tag: ${{ steps.version.outputs.tag }}
      image_name: ${{ steps.image-name.outputs.name }}

    steps:
      - name: Set image name to lowercase
        id: image-name
        run: |
          REPO="${{ github.repository }}"
          echo "name=${REPO,,}" >> $GITHUB_OUTPUT

      - name: Get version from release tag
        id: version
        run: |
          # Release tag is like "v1.2.0"
          echo "tag=${{ github.event.release.tag_name }}" >> $GITHUB_OUTPUT

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Pull latest staging image and retag for production
        run: |
          # Pull the latest image (which was deployed to staging)
          docker pull ${{ env.REGISTRY }}/${{ steps.image-name.outputs.name }}:latest

          # Tag it with the release version
          docker tag ${{ env.REGISTRY }}/${{ steps.image-name.outputs.name }}:latest \
            ${{ env.REGISTRY }}/${{ steps.image-name.outputs.name }}:${{ steps.version.outputs.tag }}

          # Push the version-tagged image
          docker push ${{ env.REGISTRY }}/${{ steps.image-name.outputs.name }}:${{ steps.version.outputs.tag }}

      - name: Generate summary
        run: |
          echo "## Production Image Promoted" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "**Version:** ${{ steps.version.outputs.tag }}" >> $GITHUB_STEP_SUMMARY
          echo "**Image:** ${{ env.REGISTRY }}/${{ steps.image-name.outputs.name }}:${{ steps.version.outputs.tag }}" >> $GITHUB_STEP_SUMMARY

  deploy-production:
    name: Deploy to Production
    needs: promote-image
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://example.com  # UPDATE: Your production URL

    steps:
      - name: Deploy notification
        run: |
          echo "## Production Deployment" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "**Version:** ${{ needs.promote-image.outputs.version_tag }}" >> $GITHUB_STEP_SUMMARY
          echo "**Image:** ${{ env.REGISTRY }}/${{ needs.promote-image.outputs.image_name }}:${{ needs.promote-image.outputs.version_tag }}" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "Ready for DOCO-CD to pick up the new image tag." >> $GITHUB_STEP_SUMMARY

      # TODO: Add your deployment method here
      - name: Placeholder - Update infra repo
        run: |
          echo "In production, this step would update prod/docker-compose.yml in the infra repo"
          echo "with the new image tag: ${{ needs.promote-image.outputs.version_tag }}"
```

**What this does:**
- **Promote Image**: Pulls the `latest` image and retags it with the release version (e.g., `v1.2.0`)
- **Deploy**: Placeholder for your production deployment method

---

## Dockerfile

A production-ready multi-stage Dockerfile with security best practices.

```dockerfile
# Build stage
FROM node:20-slim AS builder

# Install build dependencies (adjust based on your needs)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci && \
    npm cache clean --force

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim AS production

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y \
    dumb-init \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (IMPORTANT: security best practice)
RUN groupadd -g 1001 nodejs && \
    useradd -m -u 1001 -g nodejs nodejs

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/build ./build

# Copy database schema and config files (adjust paths for your project)
COPY --from=builder --chown=nodejs:nodejs /app/app/lib/db ./app/lib/db
COPY --from=builder --chown=nodejs:nodejs /app/drizzle.config.ts ./drizzle.config.ts

# Copy migration files for runtime execution
COPY --from=builder --chown=nodejs:nodejs /app/drizzle ./drizzle

# Switch to non-root user
USER nodejs

EXPOSE 3000

ENV NODE_ENV=production

# Health check (adjust endpoint for your app)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); })"

# Start with signal handling (prestart script runs migrations)
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
```

**Key features:**
- Multi-stage build (smaller final image)
- Non-root user (`nodejs:1001`)
- `dumb-init` for proper signal handling
- Health check endpoint
- Migrations copied for runtime execution

---

## Database Migrations

### Drizzle Configuration (`drizzle.config.ts`)

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./app/lib/db/schema.ts",  // UPDATE: Path to your schema
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### Migration Workflow

1. **Local Development**: Modify your schema, then run:
   ```bash
   npm run db:generate
   ```
   This creates a new migration file in `drizzle/`.

2. **Commit**: Commit both the schema change and the migration file.

3. **CI Verification**: The PR checks will:
   - Run `db:generate` and fail if uncommitted schema changes exist
   - Apply all migrations to a fresh database to verify they work

4. **Runtime**: The `prestart` script runs migrations before the app starts.

---

## GitHub Configuration

### 1. Repository Settings

#### Actions Permissions (Settings → Actions → General)

| Setting | Value |
|---------|-------|
| Workflow permissions | "Read and write permissions" |
| Allow GitHub Actions to create and approve pull requests | ✅ Enabled |

#### General Settings (Settings → General)

| Setting | Recommendation |
|---------|---------------|
| Automatically delete head branches | ✅ Enable |

### 2. Repository Secrets (Settings → Secrets and variables → Actions)

| Secret | Required | Description |
|--------|----------|-------------|
| `RELEASE_TOKEN` | Yes | Fine-grained PAT for Release Please |

**Creating RELEASE_TOKEN:**

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Create a new token with these permissions for your repository:
   - `Contents`: Read and write
   - `Pull requests`: Read and write
   - `Metadata`: Read (automatically included)
3. Add the token as a repository secret named `RELEASE_TOKEN`

### 3. Environments (Settings → Environments)

#### Staging Environment

| Setting | Value |
|---------|-------|
| Name | `staging` |
| Deployment branches | Selected branches: `main` |
| Required reviewers | Optional |
| Wait timer | None |

#### Production Environment

| Setting | Value |
|---------|-------|
| Name | `production` |
| Deployment branches and tags | All branches OR tag rule: `v*` |
| Required reviewers | 1-2 recommended |
| Wait timer | Optional (5-15 min) |

**Important:** Production must allow tags (e.g., `v*`), not just the `main` branch, since releases trigger from tags.

### 4. Branch Protection (Settings → Branches)

Create a rule for your main branch (`main` or `master`):

| Setting | Value |
|---------|-------|
| Require a pull request before merging | ✅ |
| Require approvals | 1+ recommended |
| Require status checks to pass before merging | ✅ |
| Status checks required | `Lint & Typecheck`, `Migration Check`, `Security Scan` |
| Require branches to be up to date before merging | ✅ |

---

## Testing the Pipeline

### 1. Test PR Checks

1. Create a new branch
2. Make a small change (e.g., add a comment)
3. Open a PR
4. Verify all three checks pass: Lint, Migrations, Security

### 2. Test Staging Deploy

1. Merge the PR to `main`
2. Watch the "Staging Deploy" workflow
3. Verify the image appears in GHCR (Packages tab)

### 3. Test Release Flow

1. Merge a commit with `feat: add new feature` message
2. Release Please will open a "Release PR"
3. Merge the Release PR
4. A GitHub Release is created with tag `v0.1.0`
5. "Production Deploy" workflow runs

### 4. Verify Image Tags

After a full cycle, your GHCR should have:
- `latest` - Most recent build
- `sha-abc1234` - Commit-specific builds
- `v0.1.0` - Release versions

---

## Customization Guide

### Using a Different ORM

Replace the migration check in `pr-checks.yml`:

**Prisma:**
```yaml
- name: Check for migration drift
  run: |
    npx prisma generate
    npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --exit-code
  env:
    DATABASE_URL: postgres://postgres:postgres@localhost:5432/test_db

- name: Test migrations apply cleanly
  run: npx prisma migrate deploy
  env:
    DATABASE_URL: postgres://postgres:postgres@localhost:5432/test_db
```

### Using a Different Database

Update the service container in `pr-checks.yml`:

**MySQL:**
```yaml
services:
  mysql:
    image: mysql:8
    env:
      MYSQL_ROOT_PASSWORD: password
      MYSQL_DATABASE: test_db
    options: >-
      --health-cmd "mysqladmin ping -h localhost"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
    ports:
      - 3306:3306
```

### Adding E2E Tests

Add a new job to `pr-checks.yml`:

```yaml
e2e:
  name: E2E Tests
  runs-on: ubuntu-latest
  needs: [lint, migrations]

  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - run: npm ci
    - run: npx playwright install --with-deps
    - run: npm run test:e2e
```

### Adding Deployment Steps

Replace the placeholder deployment step with your method:

**SSH Deployment:**
```yaml
- name: Deploy via SSH
  uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.SERVER_HOST }}
    username: ${{ secrets.SERVER_USER }}
    key: ${{ secrets.SSH_PRIVATE_KEY }}
    script: |
      cd /app
      docker compose pull
      docker compose up -d
```

**GitOps (Update Infra Repo):**
```yaml
- name: Update infra repo
  uses: peter-evans/repository-dispatch@v2
  with:
    token: ${{ secrets.INFRA_REPO_TOKEN }}
    repository: your-org/infra-repo
    event-type: deploy-staging
    client-payload: '{"image_tag": "${{ needs.build.outputs.sha_tag }}"}'
```

---

## Troubleshooting

### Release Please Not Creating PRs

1. Ensure commits use conventional commit format (`feat:`, `fix:`, etc.)
2. Check that `RELEASE_TOKEN` secret is set correctly
3. Verify the token has `contents: write` and `pull-requests: write` permissions

### Migration Drift Detected

This means your schema changed but you didn't generate a migration:

```bash
npm run db:generate
git add drizzle/
git commit -m "chore: add migration for schema changes"
```

### Package Not Public

The workflow tries to make the package public automatically. If it fails:
1. Go to your package in GHCR
2. Click "Package settings"
3. Change visibility to "Public"

### Environment Protection Rules Blocking Deploy

If production deploy fails due to environment rules:
1. Check Settings → Environments → production
2. Ensure "Deployment branches and tags" includes tags or `v*` pattern
3. Approve any pending deployment reviews

---

## Quick Reference

| Action | Command/Workflow |
|--------|-----------------|
| Generate migration | `npm run db:generate` |
| Apply migrations locally | `npm run db:migrate` |
| Build locally | `npm run build` |
| Run PR checks | Open/update PR |
| Deploy to staging | Merge to `main` |
| Create release | Merge Release Please PR |
| Deploy to production | Publish GitHub Release |

---

## Files Checklist

Copy these files to your new repository:

- [ ] `.github/workflows/pr-checks.yml`
- [ ] `.github/workflows/staging-deploy.yml`
- [ ] `.github/workflows/release-please.yml`
- [ ] `.github/workflows/production-deploy.yml`
- [ ] `Dockerfile` (customize for your app)
- [ ] `drizzle.config.ts` (or your ORM config)
- [ ] Update `package.json` scripts

Configure in GitHub:

- [ ] Actions permissions (read/write)
- [ ] `RELEASE_TOKEN` secret
- [ ] `staging` environment
- [ ] `production` environment (with tag rules)
- [ ] Branch protection rules
