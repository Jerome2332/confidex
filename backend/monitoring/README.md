# Confidex Monitoring Stack

Production-ready monitoring infrastructure using Prometheus, Grafana, and Alertmanager.

## Quick Start

```bash
# Start the monitoring stack
cd backend/monitoring
docker-compose up -d

# Access dashboards
open http://localhost:3002  # Grafana (admin/changeme)
open http://localhost:9090  # Prometheus
open http://localhost:9093  # Alertmanager
```

## Components

| Component | Port | Purpose |
|-----------|------|---------|
| Prometheus | 9090 | Metrics collection and storage |
| Grafana | 3002 | Dashboards and visualization |
| Alertmanager | 9093 | Alert routing and notifications |
| Redis | 6379 | Rate limiting backend (optional) |

## Configuration

### Environment Variables

Create a `.env` file in this directory:

```env
# Grafana admin password (change in production!)
GRAFANA_ADMIN_PASSWORD=your-secure-password

# Slack webhook for alerts (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# PagerDuty service key (optional)
PAGERDUTY_SERVICE_KEY=your-service-key
```

### Connecting to Backend

The monitoring stack expects the Confidex backend to be running at `localhost:3001`.

For production, update `prometheus/prometheus.yml`:

```yaml
- job_name: 'confidex-backend-prod'
  static_configs:
    - targets: ['your-production-url:443']
  scheme: https
  metrics_path: /metrics
```

## Dashboards

### Confidex Overview

Main dashboard showing:
- Crank service status and health
- Wallet balances
- HTTP request rates and latency
- MPC operation performance
- RPC connection health
- Node.js runtime metrics

Access at: http://localhost:3002/d/confidex-overview

## Alert Rules

Alerts are defined in `prometheus/rules/confidex.yml`.

### Critical Alerts (immediate response required)

| Alert | Condition | Action |
|-------|-----------|--------|
| CrankWalletLowBalance | Balance < 0.5 SOL | Top up wallet immediately |
| CrankServiceDown | Status = 0 for 2m | Check logs, restart service |
| APIHighErrorRate | 5xx rate > 1% | Investigate errors |
| ConfidexBackendDown | Service unreachable | Check deployment |

### Warning Alerts (investigate soon)

| Alert | Condition | Action |
|-------|-----------|--------|
| CrankCircuitBreakerTripped | Status = -1 | Check recent errors |
| MPCHighTimeoutRate | Timeout rate > 5% | Check Arcium cluster |
| RPCFailover | Failover occurred | Check primary RPC |
| ZKProofSlow | p95 > 5s | Investigate prover |

## Customization

### Adding New Dashboards

1. Create JSON dashboard in `grafana/dashboards/`
2. Restart Grafana: `docker-compose restart grafana`

### Adding New Alert Rules

1. Edit `prometheus/rules/confidex.yml`
2. Reload Prometheus: `curl -X POST http://localhost:9090/-/reload`

### Configuring Slack Alerts

1. Create Slack incoming webhook
2. Update `alertmanager/alertmanager.yml` with webhook URL
3. Restart Alertmanager: `docker-compose restart alertmanager`

## Maintenance

### Backup Grafana

```bash
docker cp confidex-grafana:/var/lib/grafana ./grafana-backup
```

### View Logs

```bash
docker-compose logs -f prometheus
docker-compose logs -f grafana
docker-compose logs -f alertmanager
```

### Update Images

```bash
docker-compose pull
docker-compose up -d
```

## Troubleshooting

### Prometheus not scraping

1. Check target health: http://localhost:9090/targets
2. Verify backend is running on port 3001
3. Check firewall rules

### Grafana dashboards empty

1. Verify Prometheus datasource: Settings > Data Sources
2. Check time range (default: last 1 hour)
3. Verify metrics are being collected: http://localhost:9090/graph

### Alerts not firing

1. Check alert rules: http://localhost:9090/alerts
2. Verify Alertmanager connection: http://localhost:9090/status
3. Check Alertmanager logs for delivery errors
