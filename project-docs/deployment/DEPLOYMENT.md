# Confidex Deployment Runbook

This document provides step-by-step instructions for deploying Confidex components.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Solana Program Deployment](#solana-program-deployment)
4. [Frontend Deployment](#frontend-deployment)
5. [Backend Deployment](#backend-deployment)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Rollback Procedures](#rollback-procedures)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools

| Tool | Version | Installation |
|------|---------|--------------|
| Node.js | ≥20.0.0 | `nvm install 20` |
| pnpm | ≥8.0.0 | `npm install -g pnpm` |
| Rust | 1.89.0 | `rustup default 1.89.0` |
| Solana CLI | 1.18.22 | See [Solana docs](https://docs.solana.com/cli/install-solana-cli-tools) |
| Anchor CLI | 0.29.0 | `avm install 0.29.0 && avm use 0.29.0` |

### Required Access

- GitHub repository write access
- Solana deployer keypair (with ≥2 SOL for devnet, ≥10 SOL for mainnet)
- Vercel account (for frontend hosting)
- Server SSH access (for backend)

---

## Environment Setup

### GitHub Secrets Configuration

Configure these secrets in GitHub Settings → Secrets and Variables → Actions:

| Secret | Description | Required |
|--------|-------------|----------|
| `DEPLOYER_KEYPAIR` | Base64-encoded Solana keypair JSON | Yes |
| `VERCEL_TOKEN` | Vercel deployment token | For frontend |
| `HELIUS_API_KEY` | Helius RPC API key | Recommended |

### GitHub Variables

Configure these variables in GitHub Settings → Secrets and Variables → Actions:

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_PROGRAM_ID` | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` | DEX program ID |
| `NEXT_PUBLIC_MXE_PROGRAM_ID` | `HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS` | MXE program ID |
| `NEXT_PUBLIC_MXE_X25519_PUBKEY` | `46589a2f72e04b041864f84900632a8a017173ddc002f37d5ab3c7a69e1a1f1b` | MXE encryption key |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | RPC endpoint |
| `VERCEL_PROJECT_ID` | - | Vercel project ID |

### Create Deployer Keypair

```bash
# Generate new keypair
solana-keygen new -o deployer.json

# Get public key
solana-keygen pubkey deployer.json

# Fund on devnet
solana airdrop 2 <PUBKEY> -u devnet

# Encode for GitHub secret
base64 deployer.json | tr -d '\n'
```

---

## Solana Program Deployment

### Manual Deployment

```bash
# 1. Set Solana config
solana config set --url devnet
solana config set --keypair ~/.config/solana/deployer.json

# 2. Check balance (need ≥2 SOL)
solana balance

# 3. Build programs
anchor build

# 4. Deploy
anchor deploy --provider.cluster devnet

# 5. Verify deployment
solana program show <PROGRAM_ID>
```

### Upgrade Existing Program

```bash
# 1. Build with new code
anchor build

# 2. Upgrade (preserves program ID)
anchor upgrade target/deploy/confidex_dex.so \
  --program-id <PROGRAM_ID> \
  --provider.cluster devnet

# 3. Verify
solana program show <PROGRAM_ID>
```

### Program Feature Flags

Build with specific features:

```bash
# Production (ZK verification enabled)
anchor build -- --features mainnet

# Development (ZK verification can be skipped)
anchor build -- --features devnet,skip-zk-verification

# Debug logging (NEVER use in production)
anchor build -- --features devnet,debug
```

---

## Frontend Deployment

### Vercel Deployment (Recommended)

```bash
# 1. Install Vercel CLI
pnpm add -g vercel

# 2. Login
vercel login

# 3. Link project
cd frontend
vercel link

# 4. Deploy preview
vercel

# 5. Deploy production
vercel --prod
```

### Manual Deployment

```bash
cd frontend

# 1. Install dependencies
pnpm install

# 2. Create .env.production
cat > .env.production << EOF
NEXT_PUBLIC_PROGRAM_ID=63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
NEXT_PUBLIC_MXE_PROGRAM_ID=HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS
NEXT_PUBLIC_MXE_X25519_PUBKEY=46589a2f72e04b041864f84900632a8a017173ddc002f37d5ab3c7a69e1a1f1b
NEXT_PUBLIC_NETWORK=devnet
NEXT_PUBLIC_ARCIUM_ENABLED=true
EOF

# 3. Build
pnpm build

# 4. Start (or configure nginx/pm2)
pnpm start
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_PROGRAM_ID` | Yes | DEX program address |
| `NEXT_PUBLIC_MXE_PROGRAM_ID` | Yes | MXE program address |
| `NEXT_PUBLIC_MXE_X25519_PUBKEY` | Yes | MXE encryption key |
| `NEXT_PUBLIC_NETWORK` | Yes | `devnet` or `mainnet-beta` |
| `NEXT_PUBLIC_ARCIUM_ENABLED` | Yes | Enable Arcium MPC |
| `NEXT_PUBLIC_HELIUS_API_KEY` | Recommended | Helius RPC key |

---

## Backend Deployment

### Using PM2 (Recommended)

```bash
cd backend

# 1. Install dependencies
pnpm install

# 2. Build
pnpm build

# 3. Configure environment
cp .env.production.example .env.production
# Edit .env.production with your values

# 4. Start with PM2
pnpm pm2:start

# 5. Enable startup on reboot
pm2 startup
pm2 save
```

### PM2 Commands

```bash
# View status
pnpm pm2:status

# View logs
pnpm pm2:logs

# Restart
pnpm pm2:restart

# Stop
pnpm pm2:stop
```

### Using Systemd

```bash
# 1. Create service file
sudo cat > /etc/systemd/system/confidex-backend.service << EOF
[Unit]
Description=Confidex Backend Service
After=network.target

[Service]
Type=simple
User=confidex
WorkingDirectory=/opt/confidex/backend
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/confidex/backend/.env.production

[Install]
WantedBy=multi-user.target
EOF

# 2. Enable and start
sudo systemctl daemon-reload
sudo systemctl enable confidex-backend
sudo systemctl start confidex-backend

# 3. Check status
sudo systemctl status confidex-backend
```

### Crank Service Configuration

The crank service requires these environment variables:

```env
# Required
CRANK_ENABLED=true
CRANK_RPC_PRIMARY=https://api.devnet.solana.com
CONFIDEX_PROGRAM_ID=63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
MXE_PROGRAM_ID=HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS
ADMIN_API_KEY=<generate with: openssl rand -hex 32>

# Wallet Configuration (use ONE of these options)
# Option 1: File path (for local development)
CRANK_WALLET_PATH=./keys/crank-wallet.json

# Option 2: Secret key directly (RECOMMENDED for production/Docker)
# Accepts JSON array format [1,2,3,...] or base58 string
CRANK_WALLET_SECRET_KEY=[your,secret,key,bytes,here]

# Optional tuning
CRANK_POLLING_INTERVAL_MS=5000
CRANK_USE_ASYNC_MPC=true
CRANK_MAX_CONCURRENT_MATCHES=5
CRANK_MIN_SOL_BALANCE=0.1
CRANK_ERROR_THRESHOLD=10
CRANK_PAUSE_DURATION_MS=60000
```

### Render Deployment (Recommended for Production)

Confidex backend is deployed on Render with Docker containerization.

**Live URL:** https://confidex-uflk.onrender.com

#### Required Environment Variables for Render

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `ADMIN_API_KEY` | Admin authentication | `<openssl rand -hex 32>` |
| `CONFIDEX_PROGRAM_ID` | DEX program address | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` |
| `MXE_PROGRAM_ID` | MXE program address | `HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS` |
| `CRANK_RPC_PRIMARY` | Solana RPC endpoint | `https://api.devnet.solana.com` |
| `CRANK_WALLET_SECRET_KEY` | Wallet secret key | `[104,33,2,...]` (JSON array) |
| `CRANK_ENABLED` | Enable crank service | `true` |
| `CRANK_USE_REAL_MPC` | Use real Arcium MPC | `true` |

#### Wallet Loading Priority

The crank wallet is loaded in this order:
1. `CRANK_WALLET_SECRET_KEY` env var (JSON array or base58 string)
2. File at `CRANK_WALLET_PATH` (fallback for local dev)

**Security:** Never commit wallet keys to git or bake them into Docker images. Use environment variables for production deployments.

---

## Post-Deployment Verification

### Program Verification

```bash
# Check program is deployed
solana program show <PROGRAM_ID> -u devnet

# Verify program is executable
solana account <PROGRAM_ID> -u devnet | grep executable
```

### Frontend Verification

1. Open the deployed URL
2. Connect wallet
3. Verify trading pair loads
4. Check browser console for errors
5. Test order placement (devnet)

### Backend Verification

```bash
# Health check (requires Origin header in production due to CORS)
curl -H "Origin: https://www.confidex.xyz" https://confidex-uflk.onrender.com/health

# Example response:
# {"status":"ok","timestamp":"...","version":"0.1.0","uptime":147,...}

# Crank status (requires admin API key)
curl -H "X-API-Key: YOUR_ADMIN_KEY" https://confidex-uflk.onrender.com/api/admin/crank/status
```

### MPC Integration Verification

```bash
# Run MPC integration tests
cd frontend
npx tsx test-mpc-integration.ts
```

---

## Rollback Procedures

### Program Rollback

Programs cannot be easily rolled back. Options:

1. **Redeploy previous version**: Build from previous commit and upgrade
2. **Use upgrade authority**: If set, can transfer to new program
3. **Pause exchange**: Call `pause_exchange` to halt trading

```bash
# Checkout previous version
git checkout <previous-commit>

# Rebuild
anchor build

# Upgrade to previous version
anchor upgrade target/deploy/confidex_dex.so \
  --program-id <PROGRAM_ID> \
  --provider.cluster devnet
```

### Frontend Rollback

```bash
# Vercel: Promote previous deployment
vercel rollback

# Manual: Deploy previous build
git checkout <previous-commit>
cd frontend && pnpm build && pnpm start
```

### Backend Rollback

```bash
# Checkout previous version
git checkout <previous-commit>

# Rebuild and restart
cd backend
pnpm install
pnpm build
pnpm pm2:restart
```

---

## Troubleshooting

### Common Issues

#### Program Deployment Fails

```
Error: Account not found
```
- **Cause**: Insufficient SOL balance
- **Fix**: `solana airdrop 2 <PUBKEY> -u devnet`

#### Frontend Build Fails

```
Error: Cannot find module '@arcium-hq/client'
```
- **Cause**: Missing dependencies
- **Fix**: `pnpm install --frozen-lockfile`

#### Crank Service Crashes

```
Error: Circuit breaker tripped
```
- **Cause**: Too many consecutive errors
- **Fix**: Check RPC connection, wait for pause duration, service auto-resumes

#### MPC Operations Timeout

```
Error: MPC computation timed out
```
- **Cause**: Arcium cluster issues
- **Fix**: Check cluster status, retry with different cluster offset (456 or 789)

### Debug Commands

```bash
# Check Solana cluster status
solana cluster-version -u devnet

# Check program logs
solana logs <PROGRAM_ID> -u devnet

# Check backend logs
tail -f backend/logs/out.log

# Check MXE status
arcium mxe-info <MXE_PROGRAM_ID> -u devnet
```

### Getting Help

- **GitHub Issues**: https://github.com/Jerome2332/confidex/issues
- **Arcium Discord**: For MPC-related issues
- **Solana Discord**: For program deployment issues

---

## Deployment Checklist

### Pre-Deployment

- [ ] All tests pass (`pnpm test`)
- [ ] Build succeeds (`anchor build`, `pnpm build`)
- [ ] Environment variables configured
- [ ] Deployer wallet funded (≥2 SOL devnet)
- [ ] Team notified of deployment window

### Deployment

- [ ] Programs deployed and verified
- [ ] Frontend deployed and accessible
- [ ] Backend deployed and healthy
- [ ] Crank service running

### Post-Deployment

- [ ] Health checks pass
- [ ] MPC integration verified
- [ ] Test trade executed (devnet)
- [ ] Monitoring dashboards checked
- [ ] Deployment documented in changelog

---

## Production Readiness Checklist

### Smart Contract

- [ ] All programs deployed to devnet/mainnet
  - `confidex_dex`: `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB`
  - `confidex_mxe`: `HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS`
  - `eligibility_verifier`: `9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W`
- [ ] ExchangeState initialized with correct `fee_recipient`
- [ ] Trading pair(s) created and active
- [ ] Fee BPS configured (`maker_fee_bps`, `taker_fee_bps`)

### Crank Service

- [ ] `CRANK_ENABLED=true`
- [ ] `CRANK_USE_REAL_MPC=true` (default is now true as of Jan 2026)
- [ ] Crank wallet funded (>0.5 SOL recommended)
- [ ] Helius RPC configured (not public devnet)
- [ ] SQLite database path writable (`CRANK_DB_PATH=./data/crank.db`)
- [ ] PM2 or systemd configured for auto-restart

### MPC Configuration

- [ ] MXE deployed and keygen complete (DKG auto-completes on deploy)
- [ ] `NEXT_PUBLIC_MXE_X25519_PUBKEY` set to `46589a2f72e04b041864f84900632a8a017173ddc002f37d5ab3c7a69e1a1f1b`
- [ ] Cluster 456 accessible (v0.6.3 with 2/2 nodes)
- [ ] Computation definitions initialized (11 circuits)
- [ ] Circuit files on GitHub Releases

### Frontend

- [ ] Environment variables set
- [ ] Build successful (`pnpm build`)
- [ ] Wallet adapter configured for correct network
- [ ] Order book shows "Live" when real orders exist
- [ ] Trades tab shows "Live" when settlements occur

### Monitoring

- [ ] Crank status endpoint: `GET /admin/crank/status`
- [ ] Wallet balance alerts configured
- [ ] Error logging to Sentry/similar

### Success Criteria

- [ ] Real tokens transfer on settlement
- [ ] Fees collected to fee_recipient
- [ ] Liquidation payouts distributed correctly
- [ ] Crank runs in production MPC mode by default
- [ ] No double-settlement possible (idempotency)
- [ ] Order book shows real on-chain orders
- [ ] Recent trades shows actual settlements
- [ ] All existing tests pass
- [ ] Settlement persists across crank restarts (SQLite)

---

*Last updated: January 2026*
