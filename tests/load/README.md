# Load Testing with k6

This directory contains load tests for the Confidex DEX using [k6](https://k6.io/).

## Prerequisites

1. Install k6:
   ```bash
   # macOS
   brew install k6

   # Linux
   sudo gpg -k
   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update
   sudo apt-get install k6
   ```

2. Ensure the backend API is running:
   ```bash
   cd backend && pnpm dev
   ```

## API Endpoints Tested

The load tests exercise the following API endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/orders/simulate` | POST | Order placement simulation with encrypted data validation |
| `/api/orderbook/:pair` | GET | Privacy-preserving order book (counts only, no amounts) |
| `/api/status/crank` | GET | Public crank/settlement status |
| `/metrics` | GET | Prometheus metrics endpoint |
| `/health/ready` | GET | Health check (setup verification) |

## Available Tests

### Settlement Load Test

Tests settlement throughput and latency under load.

```bash
# Basic run (5 VUs, 30 seconds)
k6 run --vus 5 --duration 30s tests/load/settlement.js

# Full staged profile (warm up → stress → peak)
k6 run tests/load/settlement.js

# Custom VUs and duration
k6 run --vus 10 --duration 5m tests/load/settlement.js

# With custom base URL
k6 run -e BASE_URL=http://localhost:3001 tests/load/settlement.js

# Output to JSON for analysis
k6 run --out json=results.json tests/load/settlement.js
```

## Latest Test Results

Results from load test run (5 VUs, 30s):

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| HTTP P95 Duration | < 3000ms | 85.86ms | ✓ Pass |
| HTTP Error Rate | < 1% | 0.00% | ✓ Pass |
| Order Placement P95 | < 2000ms | 11.1ms | ✓ Pass |
| Settlement P99 | < 5000ms | 40.92ms | ✓ Pass |
| Settlement Success Rate | > 95% | 100.00% | ✓ Pass |

All endpoint checks passed:
- ✓ Settlement status is 200
- ✓ Settlement status has data
- ✓ Order placement status is 200 or 201
- ✓ Order placement has order ID
- ✓ Order book status is 200
- ✓ Order book has bids and asks
- ✓ Metrics status is 200
- ✓ Metrics contains settlement data

## Test Targets (SLOs)

| Metric | Target | Rationale |
|--------|--------|-----------|
| Settlement Success Rate | > 95% | Production reliability requirement |
| Settlement P99 Latency | < 5 seconds | User experience threshold |
| Order Placement P95 | < 2 seconds | Competitive with centralized exchanges |
| HTTP Error Rate | < 1% | General API reliability |

## Metrics Collected

### Custom Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `settlement_success_rate` | Rate | Percentage of successful settlements |
| `settlement_latency_ms` | Trend | Settlement operation latency |
| `settlement_errors` | Counter | Total settlement errors |
| `settlements_completed` | Counter | Total successful settlements |
| `order_placement_latency_ms` | Trend | Order placement latency |
| `order_placement_errors` | Counter | Order placement errors |

### Built-in k6 Metrics

- `http_req_duration` - HTTP request duration
- `http_req_failed` - HTTP request failure rate
- `vus` - Number of virtual users
- `iterations` - Total test iterations

## Load Profiles

The settlement test uses a staged load profile:

1. **Warm up** (30s): 5 VUs - Basic functionality verification
2. **Ramp up** (2m): 5 → 20 VUs - Gradual load increase
3. **Sustain** (5m): 20 VUs - Steady state performance
4. **Stress** (2m): 20 → 50 VUs - High load stress test
5. **Peak** (3m): 50 VUs - Maximum load
6. **Ramp down** (1m): 50 → 0 VUs - Graceful shutdown

## Integration with CI/CD

Add to GitHub Actions workflow:

```yaml
- name: Run Load Tests
  run: |
    k6 run --out json=k6-results.json tests/load/settlement.js
  env:
    BASE_URL: ${{ secrets.STAGING_API_URL }}
    ENVIRONMENT: staging

- name: Upload Load Test Results
  uses: actions/upload-artifact@v4
  with:
    name: k6-results
    path: k6-results.json
```

## Grafana Integration

For real-time monitoring, output to InfluxDB:

```bash
k6 run --out influxdb=http://localhost:8086/k6 tests/load/settlement.js
```

Then import the k6 dashboard in Grafana (ID: 2587).

## Writing New Load Tests

1. Create a new file in `tests/load/`
2. Define `options` with stages and thresholds
3. Export `setup()`, `default`, and `teardown()` functions
4. Use custom metrics for application-specific measurements

Example template:

```javascript
import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const successRate = new Rate('custom_success_rate');
const latency = new Trend('custom_latency_ms');

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '3m', target: 10 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    'custom_success_rate': ['rate>0.95'],
    'custom_latency_ms': ['p(99)<3000'],
  },
};

export default function() {
  const start = Date.now();
  const res = http.get('http://localhost:3001/api/endpoint');
  latency.add(Date.now() - start);
  successRate.add(res.status === 200);
}
```

## Rate Limiting

The backend applies rate limiting to protect against abuse. In development mode, limits are relaxed:

| Environment | Standard Limit |
|-------------|----------------|
| Production | 100 requests/minute |
| Development | 500 requests/minute |

For high-throughput load testing, set `LOAD_TEST_MODE=true`:

```bash
LOAD_TEST_MODE=true pnpm dev
```

This increases limits to 5000 requests/minute on test endpoints.

## Troubleshooting

### Test fails immediately

Check that the API is running and accessible:
```bash
curl http://localhost:3001/health/ready
```

### High error rate (429 Too Many Requests)

Rate limiting is active. Options:
1. Use `LOAD_TEST_MODE=true` when starting the backend
2. Reduce the number of VUs
3. Add delays between requests in the test

### High error rate (other)

- Check backend logs for errors
- Verify database connections
- Check RPC rate limits

### Slow performance

- Monitor CPU/memory on backend
- Check database query performance
- Review RPC endpoint latency
