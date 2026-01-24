# Mainnet Deployment Guide

This guide covers mainnet-specific considerations beyond the standard [DEPLOYMENT.md](./DEPLOYMENT.md) runbook.

## Table of Contents

1. [Pre-Mainnet Checklist](#pre-mainnet-checklist)
2. [Network Configuration](#network-configuration)
3. [Security Hardening](#security-hardening)
4. [RPC Provider Setup](#rpc-provider-setup)
5. [Wallet Management](#wallet-management)
6. [Program Deployment](#program-deployment)
7. [Monitoring & Alerting](#monitoring--alerting)
8. [Incident Response](#incident-response)
9. [Mainnet Verification](#mainnet-verification)

---

## Pre-Mainnet Checklist

### Security Audit

- [ ] Smart contract audit completed by reputable firm
- [ ] ZK circuit audit completed
- [ ] Frontend security review (XSS, CSRF, input validation)
- [ ] Backend security review (authentication, rate limiting, injection)
- [ ] Penetration testing completed
- [ ] All HIGH/CRITICAL findings resolved

### Testing Milestones

- [ ] 1000+ successful trades on devnet
- [ ] Load testing passed (10x expected volume)
- [ ] Liquidation flow tested end-to-end
- [ ] Settlement verification with real token transfers
- [ ] 24-hour uptime test with synthetic load
- [ ] Failover testing (RPC, database, crank)

### Operational Readiness

- [ ] Runbook reviewed by operations team
- [ ] On-call rotation established
- [ ] Monitoring dashboards configured
- [ ] Alert thresholds defined
- [ ] Incident response plan documented
- [ ] Communication channels established (Discord, Telegram, Status Page)

---

## Network Configuration

### Mainnet Program IDs

After mainnet deployment, update these values:

```env
# Mainnet Program IDs (update after deployment)
NEXT_PUBLIC_PROGRAM_ID=<MAINNET_DEX_PROGRAM_ID>
NEXT_PUBLIC_MXE_PROGRAM_ID=<MAINNET_MXE_PROGRAM_ID>
NEXT_PUBLIC_MXE_X25519_PUBKEY=<MAINNET_MXE_X25519_KEY>
NEXT_PUBLIC_NETWORK=mainnet-beta
```

### Solana CLI Configuration

```bash
# Switch to mainnet
solana config set --url mainnet-beta

# Use premium RPC (required for mainnet reliability)
solana config set --url https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Verify configuration
solana config get
```

### Token Mints (Mainnet)

| Token | Mainnet Address | Notes |
|-------|-----------------|-------|
| SOL | Native | Wrapped automatically |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Circle USDC |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | Tether USD |

---

## Security Hardening

### Environment Variables (Mainnet)

```env
# Required for mainnet
NODE_ENV=production

# Strict mode (no fallbacks)
CRANK_USE_REAL_MPC=true
CRANK_ALLOW_SIMULATION=false

# Security
ADMIN_API_KEY=<generate with: openssl rand -hex 64>
RATE_LIMIT_STRICT=true

# Disable debug features
DEBUG=false
LOG_LEVEL=info
```

### Secrets Management

**CRITICAL**: Never store secrets in:
- Git repositories (even private ones)
- Docker images
- Plain text files
- Unencrypted environment files

**Recommended Solutions:**

| Provider | Use Case | Integration |
|----------|----------|-------------|
| AWS Secrets Manager | Production secrets | `@aws-sdk/client-secrets-manager` |
| HashiCorp Vault | Multi-cloud | HTTP API |
| Render Environment | Render hosting | Native integration |
| Vercel Environment | Vercel hosting | Native integration |

Example AWS Secrets Manager integration:

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function getSecret(secretName: string): Promise<string> {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  return response.SecretString!;
}

// Load secrets at startup
const ADMIN_API_KEY = await getSecret('confidex/admin-api-key');
const CRANK_WALLET_KEY = await getSecret('confidex/crank-wallet');
```

### Network Security

```bash
# Firewall rules (example with ufw)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH (restrict to your IP)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### SSL/TLS Configuration

Ensure all endpoints use HTTPS with modern TLS:

```nginx
# Nginx configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
ssl_prefer_server_ciphers off;
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:10m;
ssl_stapling on;
ssl_stapling_verify on;
```

---

## RPC Provider Setup

### Recommended Providers (Mainnet)

| Provider | Tier | Rate Limit | Latency | Notes |
|----------|------|------------|---------|-------|
| Helius | Professional | 500 RPS | ~50ms | Best for DeFi, includes Priority Fees API |
| Triton | Enterprise | 1000 RPS | ~40ms | High availability |
| QuickNode | Business | 300 RPS | ~60ms | Easy setup |
| Alchemy | Growth | 250 RPS | ~70ms | Good analytics |

### Failover Configuration

```env
# Primary (fastest)
CRANK_RPC_PRIMARY=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Fallback endpoints (different providers for redundancy)
CRANK_RPC_FALLBACK_1=https://your-quicknode-endpoint.com
CRANK_RPC_FALLBACK_2=https://your-triton-endpoint.com

# Failover settings
CRANK_RPC_FAILOVER_ENABLED=true
CRANK_RPC_HEALTH_CHECK_INTERVAL_MS=10000
CRANK_RPC_MAX_RETRIES=3
```

### Priority Fees (Mainnet Specific)

```env
# Enable dynamic priority fees for mainnet
CRANK_USE_PRIORITY_FEES=true
CRANK_PRIORITY_FEE_PERCENTILE=75
CRANK_MAX_PRIORITY_FEE_LAMPORTS=100000  # 0.0001 SOL max
```

```typescript
// Example: Helius Priority Fees API
const priorityFee = await fetch(
  'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
  {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getPriorityFeeEstimate',
      params: [{
        accountKeys: [PROGRAM_ID],
        options: { priorityLevel: 'High' }
      }]
    })
  }
).then(r => r.json());
```

---

## Wallet Management

### Deployer Wallet

```bash
# Generate mainnet deployer (OFFLINE recommended)
solana-keygen new -o mainnet-deployer.json --no-bip39-passphrase

# NEVER share this key. Fund with at least:
# - 10 SOL for initial deployment
# - 5 SOL buffer for upgrades

# Verify balance
solana balance mainnet-deployer.json -u mainnet-beta
```

### Crank Wallet (Hot Wallet)

```bash
# Generate dedicated crank wallet
solana-keygen new -o crank-mainnet.json --no-bip39-passphrase

# Fund with operational balance
# - 2 SOL minimum
# - 5 SOL recommended
# - Monitor via alerts
```

### Multisig for Upgrade Authority

For mainnet, use a multisig wallet for program upgrade authority:

```bash
# Using Squads Protocol (recommended)
# 1. Create multisig at squads.so
# 2. Transfer upgrade authority

solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <SQUADS_VAULT_ADDRESS> \
  --keypair mainnet-deployer.json \
  -u mainnet-beta
```

### Balance Monitoring

Set up alerts for:
- Crank wallet below 0.5 SOL
- Deployer wallet below 2 SOL
- Fee recipient balance changes (for revenue tracking)

---

## Program Deployment

### Mainnet Deployment Steps

```bash
# 1. FINAL code review and freeze
git tag -a v1.0.0-mainnet -m "Mainnet release"
git push origin v1.0.0-mainnet

# 2. Build with mainnet features
anchor build -- --features mainnet

# 3. Verify program hash matches audit
sha256sum target/deploy/confidex_dex.so
# Compare with audited hash

# 4. Configure for mainnet
solana config set --url mainnet-beta
solana config set --keypair mainnet-deployer.json

# 5. Check balance (need 10+ SOL)
solana balance

# 6. Deploy
anchor deploy --provider.cluster mainnet

# 7. Record program IDs
solana program show <PROGRAM_ID>

# 8. Initialize exchange state
# Run initialization script with mainnet parameters
```

### Post-Deployment Verification

```bash
# Verify programs are deployed
solana program show <DEX_PROGRAM_ID> -u mainnet-beta
solana program show <MXE_PROGRAM_ID> -u mainnet-beta

# Verify program is immutable (if intended)
solana program show <PROGRAM_ID> | grep "Authority"

# Test with minimal transaction
# Use dedicated test wallet with small balance
```

---

## Monitoring & Alerting

### Prometheus Metrics

Key metrics to monitor:

```yaml
# Alert rules (alertmanager/rules/confidex.yml)
groups:
  - name: confidex
    rules:
      # Crank wallet low balance
      - alert: CrankWalletLowBalance
        expr: crank_wallet_balance_sol < 0.5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Crank wallet balance critical"
          description: "Balance: {{ $value }} SOL"

      # Settlement failures
      - alert: SettlementFailureRate
        expr: rate(crank_settlement_errors_total[5m]) > 0.1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High settlement failure rate"

      # MPC timeout rate
      - alert: MPCTimeoutRate
        expr: rate(mpc_timeout_total[10m]) > 0.05
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "MPC operations timing out"

      # API latency
      - alert: HighAPILatency
        expr: histogram_quantile(0.99, http_request_duration_seconds_bucket) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "API p99 latency above 2s"

      # Error rate
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Error rate above 1%"
```

### Alerting Channels

Configure in `alertmanager/alertmanager.yml`:

```yaml
global:
  slack_api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'

route:
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'slack-critical'
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
    - match:
        severity: warning
      receiver: 'slack-warnings'

receivers:
  - name: 'slack-critical'
    slack_configs:
      - channel: '#confidex-alerts'
        send_resolved: true
        title: '{{ .Status | toUpper }}: {{ .CommonLabels.alertname }}'
        text: '{{ .CommonAnnotations.description }}'

  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_KEY'
        severity: 'critical'

  - name: 'slack-warnings'
    slack_configs:
      - channel: '#confidex-warnings'
        send_resolved: true
```

### Status Page

Set up a public status page (Statuspage, Instatus, or Cachet):

- **Operational Components**:
  - Trading Engine
  - Order Matching (MPC)
  - Settlement
  - API
  - Frontend

- **Metrics to Display**:
  - Uptime percentage
  - Average settlement time
  - Order throughput

---

## Incident Response

### Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| P1 - Critical | Trading halted | Immediate | Settlement failures, funds at risk |
| P2 - High | Degraded service | 15 minutes | High latency, partial outage |
| P3 - Medium | Minor impact | 1 hour | Non-critical feature broken |
| P4 - Low | Minimal impact | 24 hours | UI bug, documentation |

### Emergency Procedures

#### Pause Trading (P1)

```bash
# Via admin API
curl -X POST \
  -H "X-API-Key: $ADMIN_API_KEY" \
  https://api.confidex.xyz/api/admin/exchange/pause

# Via on-chain instruction (requires upgrade authority)
# Use emergency pause script
```

#### Stop Crank Service

```bash
# Via admin API
curl -X POST \
  -H "X-API-Key: $ADMIN_API_KEY" \
  https://api.confidex.xyz/api/admin/crank/stop

# Via SSH (last resort)
ssh prod-server "pm2 stop confidex-backend"
```

#### Rollback Procedure

1. Identify failing commit
2. Checkout previous stable version
3. Build and deploy
4. Verify functionality
5. Post-incident review

```bash
# Quick rollback
git checkout v1.0.0-stable
anchor build && anchor upgrade ...
```

### Communication Templates

**Incident Start:**
> [INCIDENT] We are investigating reports of [issue]. Trading may be affected. Updates to follow.

**Incident Update:**
> [UPDATE] We have identified the issue as [root cause]. Our team is working on a fix. ETA: [time].

**Incident Resolved:**
> [RESOLVED] The incident has been resolved. All systems are operational. We will publish a post-mortem within 48 hours.

---

## Mainnet Verification

### Final Checklist

Before going live:

- [ ] All devnet tests pass on mainnet-forked environment
- [ ] Load test completed at 2x expected volume
- [ ] Security headers verified (`curl -I https://api.confidex.xyz`)
- [ ] SSL certificate valid and auto-renewing
- [ ] Monitoring dashboards showing data
- [ ] Alert channels receiving test alerts
- [ ] Team trained on incident response
- [ ] Status page configured
- [ ] Documentation complete and reviewed

### Smoke Tests

After deployment:

```bash
# 1. Health check
curl https://api.confidex.xyz/health

# 2. Detailed health
curl https://api.confidex.xyz/health/detailed

# 3. Metrics endpoint
curl https://api.confidex.xyz/metrics | head -20

# 4. Frontend loads
curl -I https://www.confidex.xyz

# 5. Program accessible
solana program show <DEX_PROGRAM_ID> -u mainnet-beta
```

### Gradual Rollout

1. **Soft Launch** (Day 1-3)
   - Invite-only access
   - Low trading limits
   - Active monitoring

2. **Limited Launch** (Week 1)
   - Public access
   - Moderate limits
   - Monitor for issues

3. **Full Launch** (Week 2+)
   - Remove limits
   - Scale infrastructure as needed

---

## Appendix: Mainnet Costs

### Estimated Monthly Costs

| Component | Provider | Est. Cost |
|-----------|----------|-----------|
| RPC (Helius Professional) | Helius | $499/month |
| Backend Hosting | Render | $25-85/month |
| Frontend Hosting | Vercel | $20/month |
| Monitoring (Grafana Cloud) | Grafana | $50/month |
| Error Tracking (Sentry) | Sentry | $26/month |
| Domain + SSL | Cloudflare | Free |
| **Total** | | ~$620-750/month |

### Transaction Costs

- Program deployment: ~5 SOL
- Each settlement: ~0.000005 SOL (5000 lamports)
- MPC computation: ~0.0001 SOL per match

---

*Last updated: January 2026*
