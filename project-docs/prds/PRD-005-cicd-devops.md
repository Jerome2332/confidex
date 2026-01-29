# PRD-005: CI/CD & DevOps Automation

**Status:** Draft
**Priority:** HIGH
**Complexity:** Medium
**Estimated Effort:** 2-3 days

---

## Executive Summary

No CI/CD automation exists - all deployments are manual with no quality gates. This PRD implements GitHub Actions workflows for testing, building, linting, and automated deployment with proper secret management.

---

## Problem Statement

Current DevOps state:

1. **No CI Pipeline** - Tests not run automatically on PRs
2. **Manual Deployments** - Error-prone manual deploy process
3. **No Pre-commit Hooks** - Code quality issues caught late
4. **No Secret Management** - Sensitive data handling inconsistent
5. **No Deployment Runbook** - Knowledge siloed in individuals

---

## Scope

### In Scope
- GitHub Actions workflows (test, build, lint, deploy)
- Pre-commit hooks with Husky
- Automated devnet deployment on main branch
- Secret management via GitHub Secrets
- Deployment runbook documentation

### Out of Scope
- Mainnet deployment automation (requires additional approvals)
- Kubernetes/container orchestration
- Multi-environment promotion (staging → prod)

---

## Implementation Plan

### Task 1: GitHub Actions Test Workflow

**New Files:**
- `.github/workflows/test.yml`

```yaml
# .github/workflows/test.yml

name: Test

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '8'
  RUST_VERSION: '1.89.0'

jobs:
  # ============================================
  # Frontend Tests
  # ============================================
  frontend-test:
    name: Frontend Tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
          cache-dependency-path: frontend/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm test:coverage
        env:
          CI: true

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: frontend/coverage/lcov.info
          flags: frontend
          fail_ci_if_error: false

      - name: Check coverage thresholds
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 70" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 70% threshold"
            exit 1
          fi

  # ============================================
  # Backend Tests
  # ============================================
  backend-test:
    name: Backend Tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
          cache-dependency-path: backend/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm test:coverage
        env:
          CI: true

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: backend/coverage/lcov.info
          flags: backend
          fail_ci_if_error: false

      - name: Check coverage thresholds
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 80% threshold"
            exit 1
          fi

  # ============================================
  # Anchor Program Tests
  # ============================================
  anchor-test:
    name: Anchor Tests
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-action@stable
        with:
          toolchain: ${{ env.RUST_VERSION }}
          components: rustfmt, clippy

      - name: Cache Cargo
        uses: actions/cache@v3
        with:
          path: |
            ~/.cargo/bin/
            ~/.cargo/registry/index/
            ~/.cargo/registry/cache/
            ~/.cargo/git/db/
            target/
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}

      - name: Install Solana CLI
        run: |
          sh -c "$(curl -sSfL https://release.solana.com/v1.18.17/install)"
          echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH

      - name: Install Anchor CLI
        run: |
          cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
          avm install 0.32.1
          avm use 0.32.1

      - name: Build programs
        run: anchor build

      - name: Run tests
        run: anchor test --skip-local-validator
        env:
          ANCHOR_PROVIDER_URL: ${{ secrets.DEVNET_RPC_URL }}
          ANCHOR_WALLET: ${{ secrets.DEVNET_WALLET_PATH }}

  # ============================================
  # Lib Package Tests
  # ============================================
  lib-test:
    name: Lib Package Tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: lib

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
          cache-dependency-path: lib/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Run tests
        run: pnpm test
```

---

### Task 2: GitHub Actions Build Workflow

**New Files:**
- `.github/workflows/build.yml`

```yaml
# .github/workflows/build.yml

name: Build

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

concurrency:
  group: build-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '8'
  RUST_VERSION: '1.89.0'

jobs:
  # ============================================
  # Frontend Build
  # ============================================
  frontend-build:
    name: Frontend Build
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
          cache-dependency-path: frontend/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm tsc --noEmit

      - name: Build
        run: pnpm build
        env:
          NEXT_PUBLIC_PROGRAM_ID: ${{ vars.NEXT_PUBLIC_PROGRAM_ID }}
          NEXT_PUBLIC_MXE_PROGRAM_ID: ${{ vars.NEXT_PUBLIC_MXE_PROGRAM_ID }}
          NEXT_PUBLIC_MXE_X25519_PUBKEY: ${{ vars.NEXT_PUBLIC_MXE_X25519_PUBKEY }}
          NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET: ${{ vars.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET }}
          NEXT_PUBLIC_HELIUS_API_KEY: ${{ secrets.HELIUS_API_KEY }}

      - name: Upload build artifacts
        uses: actions/upload-artifact@v3
        with:
          name: frontend-build
          path: frontend/.next
          retention-days: 7

  # ============================================
  # Backend Build
  # ============================================
  backend-build:
    name: Backend Build
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
          cache-dependency-path: backend/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm tsc --noEmit

      - name: Build
        run: pnpm build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v3
        with:
          name: backend-build
          path: backend/dist
          retention-days: 7

  # ============================================
  # Anchor Build
  # ============================================
  anchor-build:
    name: Anchor Build
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-action@stable
        with:
          toolchain: ${{ env.RUST_VERSION }}

      - name: Cache Cargo
        uses: actions/cache@v3
        with:
          path: |
            ~/.cargo/bin/
            ~/.cargo/registry/index/
            ~/.cargo/registry/cache/
            ~/.cargo/git/db/
            target/
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}

      - name: Install Solana CLI
        run: |
          sh -c "$(curl -sSfL https://release.solana.com/v1.18.17/install)"
          echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH

      - name: Install Anchor CLI
        run: |
          cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
          avm install 0.32.1
          avm use 0.32.1

      - name: Build programs
        run: anchor build

      - name: Verify program IDs
        run: |
          # Extract declared program ID from lib.rs
          DECLARED_ID=$(grep -oP 'declare_id!\("\K[^"]+' programs/confidex_dex/src/lib.rs)

          # Get built program ID
          BUILT_ID=$(solana address -k target/deploy/confidex_dex-keypair.json)

          if [ "$DECLARED_ID" != "$BUILT_ID" ]; then
            echo "Program ID mismatch!"
            echo "Declared: $DECLARED_ID"
            echo "Built: $BUILT_ID"
            exit 1
          fi

          echo "Program ID verified: $DECLARED_ID"

      - name: Upload program artifacts
        uses: actions/upload-artifact@v3
        with:
          name: anchor-build
          path: target/deploy/*.so
          retention-days: 7
```

---

### Task 3: GitHub Actions Lint Workflow

**New Files:**
- `.github/workflows/lint.yml`

```yaml
# .github/workflows/lint.yml

name: Lint

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

concurrency:
  group: lint-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '8'
  RUST_VERSION: '1.89.0'

jobs:
  # ============================================
  # Frontend Lint
  # ============================================
  frontend-lint:
    name: Frontend Lint
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
          cache-dependency-path: frontend/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: ESLint
        run: pnpm lint

      - name: Prettier check
        run: pnpm prettier --check "src/**/*.{ts,tsx,js,jsx,json,css,md}"

  # ============================================
  # Backend Lint
  # ============================================
  backend-lint:
    name: Backend Lint
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
          cache-dependency-path: backend/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: ESLint
        run: pnpm lint

  # ============================================
  # Rust Lint
  # ============================================
  rust-lint:
    name: Rust Lint
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-action@stable
        with:
          toolchain: ${{ env.RUST_VERSION }}
          components: rustfmt, clippy

      - name: Cache Cargo
        uses: actions/cache@v3
        with:
          path: |
            ~/.cargo/bin/
            ~/.cargo/registry/index/
            ~/.cargo/registry/cache/
            ~/.cargo/git/db/
            target/
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}

      - name: Install Solana CLI
        run: |
          sh -c "$(curl -sSfL https://release.solana.com/v1.18.17/install)"
          echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH

      - name: Rustfmt
        run: cargo fmt --all -- --check

      - name: Clippy
        run: cargo clippy --all-targets --all-features -- -D warnings
```

---

### Task 4: GitHub Actions Deploy Workflow

**New Files:**
- `.github/workflows/deploy.yml`

```yaml
# .github/workflows/deploy.yml

name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment environment'
        required: true
        default: 'devnet'
        type: choice
        options:
          - devnet
          - mainnet

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false  # Don't cancel deployments

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '8'

jobs:
  # ============================================
  # Deploy Frontend
  # ============================================
  deploy-frontend:
    name: Deploy Frontend
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment || 'devnet' }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
          cache-dependency-path: frontend/pnpm-lock.yaml

      - name: Install dependencies
        working-directory: frontend
        run: pnpm install --frozen-lockfile

      - name: Build
        working-directory: frontend
        run: pnpm build
        env:
          NEXT_PUBLIC_PROGRAM_ID: ${{ vars.NEXT_PUBLIC_PROGRAM_ID }}
          NEXT_PUBLIC_MXE_PROGRAM_ID: ${{ vars.NEXT_PUBLIC_MXE_PROGRAM_ID }}
          NEXT_PUBLIC_MXE_X25519_PUBKEY: ${{ vars.NEXT_PUBLIC_MXE_X25519_PUBKEY }}
          NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET: ${{ vars.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET }}
          NEXT_PUBLIC_HELIUS_API_KEY: ${{ secrets.HELIUS_API_KEY }}
          NEXT_PUBLIC_SOLANA_NETWORK: ${{ vars.SOLANA_NETWORK }}

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: frontend
          vercel-args: ${{ github.ref == 'refs/heads/main' && '--prod' || '' }}

  # ============================================
  # Deploy Backend (Crank Service)
  # ============================================
  deploy-backend:
    name: Deploy Backend
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment || 'devnet' }}
    needs: [deploy-frontend]  # Deploy after frontend

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup SSH
        uses: webfactory/ssh-agent@v0.8.0
        with:
          ssh-private-key: ${{ secrets.DEPLOY_SSH_KEY }}

      - name: Add host key
        run: |
          mkdir -p ~/.ssh
          ssh-keyscan -H ${{ secrets.DEPLOY_HOST }} >> ~/.ssh/known_hosts

      - name: Deploy via SSH
        run: |
          ssh ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} << 'ENDSSH'
            cd /opt/confidex/backend
            git pull origin main
            pnpm install --frozen-lockfile
            pnpm build
            pm2 restart confidex-crank || pm2 start ecosystem.config.cjs
          ENDSSH

      - name: Verify deployment
        run: |
          sleep 10
          curl -f https://${{ secrets.DEPLOY_HOST }}/health || exit 1

  # ============================================
  # Deploy Anchor Program (Manual Trigger Only)
  # ============================================
  deploy-program:
    name: Deploy Anchor Program
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment || 'devnet' }}
    if: github.event_name == 'workflow_dispatch'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-action@stable
        with:
          toolchain: '1.89.0'

      - name: Install Solana CLI
        run: |
          sh -c "$(curl -sSfL https://release.solana.com/v1.18.17/install)"
          echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH

      - name: Install Anchor CLI
        run: |
          cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
          avm install 0.32.1
          avm use 0.32.1

      - name: Setup wallet
        run: |
          echo "${{ secrets.DEPLOY_WALLET_KEYPAIR }}" > /tmp/deployer.json
          chmod 600 /tmp/deployer.json

      - name: Build program
        run: anchor build

      - name: Deploy program
        run: |
          anchor deploy \
            --provider.cluster ${{ vars.SOLANA_NETWORK }} \
            --provider.wallet /tmp/deployer.json
        env:
          ANCHOR_PROVIDER_URL: ${{ secrets.DEVNET_RPC_URL }}

      - name: Cleanup wallet
        if: always()
        run: rm -f /tmp/deployer.json

      - name: Notify deployment
        uses: slackapi/slack-github-action@v1.24.0
        with:
          payload: |
            {
              "text": "Anchor program deployed to ${{ vars.SOLANA_NETWORK }}",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*Anchor Program Deployed*\n• Environment: `${{ vars.SOLANA_NETWORK }}`\n• Commit: `${{ github.sha }}`\n• Triggered by: ${{ github.actor }}"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

### Task 5: Pre-commit Hooks with Husky

**New Files:**
- `.husky/pre-commit`
- `.husky/commit-msg`

**Step 5.1: Install Husky**

```bash
# Install Husky at repo root
pnpm add -D husky lint-staged @commitlint/cli @commitlint/config-conventional

# Initialize Husky
pnpm exec husky install

# Add prepare script to package.json
npm pkg set scripts.prepare="husky install"
```

**Step 5.2: Pre-commit Hook**

```bash
#!/usr/bin/env sh
# .husky/pre-commit

. "$(dirname -- "$0")/_/husky.sh"

# Run lint-staged
pnpm exec lint-staged

# Run type checks
echo "Running type checks..."

# Frontend type check
cd frontend && pnpm tsc --noEmit || exit 1
cd ..

# Backend type check
cd backend && pnpm tsc --noEmit || exit 1
cd ..

echo "Pre-commit checks passed!"
```

**Step 5.3: Lint Staged Config**

```json
// package.json (root)
{
  "lint-staged": {
    "frontend/**/*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "backend/**/*.ts": [
      "eslint --fix",
      "prettier --write"
    ],
    "**/*.{json,md,yml,yaml}": [
      "prettier --write"
    ]
  }
}
```

**Step 5.4: Commit Message Hook**

```bash
#!/usr/bin/env sh
# .husky/commit-msg

. "$(dirname -- "$0")/_/husky.sh"

pnpm exec commitlint --edit $1
```

**Step 5.5: Commitlint Config**

```javascript
// commitlint.config.js

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // New feature
        'fix',      // Bug fix
        'docs',     // Documentation
        'style',    // Formatting
        'refactor', // Code restructuring
        'perf',     // Performance
        'test',     // Tests
        'build',    // Build system
        'ci',       // CI/CD
        'chore',    // Maintenance
        'revert',   // Revert commit
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'frontend',
        'backend',
        'programs',
        'lib',
        'docs',
        'ci',
        'deps',
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-max-length': [2, 'always', 72],
  },
};
```

---

### Task 6: Deployment Runbook

**New Files:**
- `project-docs/deployment/DEPLOYMENT.md`

```markdown
# Deployment Runbook

## Overview

This document describes the deployment process for Confidex components.

## Environments

| Environment | Purpose | Auto-Deploy |
|-------------|---------|-------------|
| devnet | Development/testing | Yes (on main merge) |
| mainnet | Production | Manual only |

## Components

### 1. Frontend (Next.js)

**Deployed to:** Vercel
**Trigger:** Automatic on push to main

#### Manual Deployment

```bash
cd frontend
vercel --prod
```

#### Rollback

```bash
# List deployments
vercel ls

# Rollback to specific deployment
vercel alias <deployment-url> <production-url>
```

### 2. Backend (Crank Service)

**Deployed to:** VPS via PM2
**Trigger:** Automatic on push to main

#### Manual Deployment

```bash
ssh user@deploy-host
cd /opt/confidex/backend
git pull origin main
pnpm install --frozen-lockfile
pnpm build
pm2 restart confidex-crank
```

#### Rollback

```bash
ssh user@deploy-host
cd /opt/confidex/backend
git checkout <previous-commit>
pnpm install --frozen-lockfile
pnpm build
pm2 restart confidex-crank
```

#### Health Check

```bash
curl https://api.confidex.exchange/health
```

### 3. Anchor Program

**Deployed to:** Solana devnet/mainnet
**Trigger:** Manual only (workflow_dispatch)

#### Manual Deployment

```bash
# Build
anchor build

# Verify program ID
solana address -k target/deploy/confidex_dex-keypair.json

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet (CAUTION)
anchor deploy --provider.cluster mainnet
```

#### Rollback

Programs cannot be rolled back. Deploy previous version as upgrade:

```bash
git checkout <previous-tag>
anchor build
anchor upgrade target/deploy/confidex_dex.so \
  --program-id 63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB \
  --provider.cluster devnet
```

## Pre-Deployment Checklist

- [ ] All tests passing in CI
- [ ] Coverage thresholds met
- [ ] No security vulnerabilities (npm audit)
- [ ] Environment variables configured
- [ ] Database migrations applied (if any)
- [ ] Feature flags configured

## Post-Deployment Verification

### Frontend

1. Open https://app.confidex.exchange
2. Verify wallet connection works
3. Place a test order
4. Check browser console for errors

### Backend

1. Check health endpoint: `curl /health`
2. Verify crank status: `curl /admin/crank/status`
3. Check logs: `pm2 logs confidex-crank`
4. Verify order matching is working

### Program

1. Verify program account exists:
   ```bash
   solana program show 63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
   ```
2. Test instruction execution via CLI or frontend

## Incident Response

### Frontend Down

1. Check Vercel dashboard for errors
2. Check browser console
3. Rollback if necessary

### Backend Down

1. SSH to server
2. Check PM2 status: `pm2 status`
3. Check logs: `pm2 logs confidex-crank --lines 100`
4. Restart: `pm2 restart confidex-crank`
5. Rollback if necessary

### Program Issues

1. Check Solana Explorer for recent transactions
2. Review program logs
3. If critical bug: pause exchange via admin instruction
4. Deploy fix as upgrade

## Secrets Management

Secrets are stored in GitHub Secrets:

| Secret | Description |
|--------|-------------|
| HELIUS_API_KEY | Helius RPC API key |
| VERCEL_TOKEN | Vercel deployment token |
| DEPLOY_SSH_KEY | SSH key for backend server |
| DEPLOY_WALLET_KEYPAIR | Solana wallet for program deploy |
| SLACK_WEBHOOK_URL | Slack notifications |
| CODECOV_TOKEN | Coverage reporting |

**Never commit secrets to the repository.**

## Contact

- **On-call:** Check PagerDuty schedule
- **Slack:** #confidex-ops
- **Email:** ops@confidex.exchange
```

---

## Acceptance Criteria

- [ ] **Test Workflow**
  - [ ] Runs on all PRs to main/develop
  - [ ] Frontend tests execute and report coverage
  - [ ] Backend tests execute and report coverage
  - [ ] Anchor tests execute
  - [ ] Coverage thresholds enforced

- [ ] **Build Workflow**
  - [ ] Frontend builds successfully
  - [ ] Backend builds successfully
  - [ ] Anchor programs build successfully
  - [ ] Build artifacts uploaded

- [ ] **Lint Workflow**
  - [ ] ESLint runs on frontend
  - [ ] ESLint runs on backend
  - [ ] Rustfmt and Clippy run on programs
  - [ ] Prettier check runs

- [ ] **Deploy Workflow**
  - [ ] Frontend deploys to Vercel on main push
  - [ ] Backend deploys via SSH on main push
  - [ ] Program deployment is manual only
  - [ ] Slack notifications sent

- [ ] **Pre-commit Hooks**
  - [ ] Lint-staged runs on commit
  - [ ] Type checks run on commit
  - [ ] Commit message format enforced

- [ ] **Documentation**
  - [ ] Deployment runbook complete
  - [ ] Rollback procedures documented
  - [ ] Secret management documented

---

## Environment Variables (GitHub)

### Variables (Non-Secret)

```
NEXT_PUBLIC_PROGRAM_ID=63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
NEXT_PUBLIC_MXE_PROGRAM_ID=4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi
NEXT_PUBLIC_MXE_X25519_PUBKEY=113364f169338f3fa0d1e76bf2ba71d40aff857dd5f707f1ea2abdaf52e2d06c
NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=456
SOLANA_NETWORK=devnet
```

### Secrets

```
HELIUS_API_KEY=<api-key>
VERCEL_TOKEN=<token>
VERCEL_ORG_ID=<org-id>
VERCEL_PROJECT_ID=<project-id>
DEPLOY_SSH_KEY=<private-key>
DEPLOY_HOST=<hostname>
DEPLOY_USER=<username>
DEPLOY_WALLET_KEYPAIR=<base58-keypair>
DEVNET_RPC_URL=https://devnet.helius-rpc.com/?api-key=<key>
SLACK_WEBHOOK_URL=<webhook-url>
CODECOV_TOKEN=<token>
```

---

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Husky Documentation](https://typicode.github.io/husky/)
- [Vercel CLI](https://vercel.com/docs/cli)
- [Anchor Deploy Guide](https://www.anchor-lang.com/docs/deployment)
