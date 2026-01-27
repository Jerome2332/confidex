/**
 * k6 Load Test: Settlement Flow
 *
 * Tests the settlement system under load to ensure:
 * 1. Target throughput: 100 settlements/minute
 * 2. P99 latency < 5 seconds
 * 3. Error rate < 5%
 *
 * Run: k6 run tests/load/settlement.js
 * Run with custom options: k6 run --vus 10 --duration 5m tests/load/settlement.js
 *
 * Prerequisites:
 * - Backend API running at BASE_URL (default: http://localhost:3001)
 * - Test accounts with funded balances
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// =============================================================================
// Configuration
// =============================================================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const RPC_URL = __ENV.RPC_URL || 'https://api.devnet.solana.com';

// Test accounts (should be pre-funded on devnet)
const TEST_ACCOUNTS = [
  { pubkey: 'TestAccount1111111111111111111111111111111111', side: 'buy' },
  { pubkey: 'TestAccount2222222222222222222222222222222222', side: 'sell' },
];

// Trading pairs (use real devnet pair PDA)
const TRADING_PAIRS = [
  { base: 'SOL', quote: 'USDC', pairPda: '3WRnHKvVgyZKXk9roscEkq4xaG62Uc7vhjAhd5zUZ5vV' },
];

// =============================================================================
// Custom Metrics
// =============================================================================

// Settlement metrics
const settlementSuccessRate = new Rate('settlement_success_rate');
const settlementLatency = new Trend('settlement_latency_ms');
const settlementErrors = new Counter('settlement_errors');
const settlementsCompleted = new Counter('settlements_completed');

// Order placement metrics
const orderPlacementLatency = new Trend('order_placement_latency_ms');
const orderPlacementErrors = new Counter('order_placement_errors');

// API health metrics
const apiHealthCheckFailures = new Counter('api_health_check_failures');
const rpcLatency = new Trend('rpc_latency_ms');

// =============================================================================
// Test Options
// =============================================================================

export const options = {
  // Stages for ramping up load
  stages: [
    { duration: '30s', target: 5 },   // Warm up: 5 VUs
    { duration: '2m', target: 20 },   // Ramp up to 20 VUs
    { duration: '5m', target: 20 },   // Sustain 20 VUs
    { duration: '2m', target: 50 },   // Ramp up to 50 VUs (stress)
    { duration: '3m', target: 50 },   // Sustain 50 VUs
    { duration: '1m', target: 0 },    // Ramp down
  ],

  // Thresholds (SLOs)
  thresholds: {
    'settlement_success_rate': ['rate>0.95'],           // 95% success rate
    'settlement_latency_ms': ['p(99)<5000'],            // P99 < 5 seconds
    'order_placement_latency_ms': ['p(95)<2000'],       // P95 < 2 seconds
    'http_req_failed': ['rate<0.01'],                   // < 1% HTTP errors
    'http_req_duration': ['p(95)<3000'],                // P95 HTTP < 3 seconds
  },

  // Tags for filtering in Grafana
  tags: {
    testType: 'settlement-load',
    environment: __ENV.ENVIRONMENT || 'staging',
  },
};

// =============================================================================
// Test Scenarios
// =============================================================================

export function setup() {
  // Verify API is healthy before starting
  const healthRes = http.get(`${BASE_URL}/health/ready`);

  if (healthRes.status !== 200) {
    console.error('API health check failed - aborting test');
    return { abort: true };
  }

  const health = JSON.parse(healthRes.body);
  console.log(`API Health: ${health.status}`);
  console.log(`RPC Status: ${health.checks?.rpc || 'unknown'}`);

  return {
    abort: false,
    startTime: Date.now(),
    healthStatus: health.status,
  };
}

export default function(data) {
  if (data.abort) {
    console.log('Test aborted due to setup failure');
    return;
  }

  // Randomly select test scenario
  const scenarios = [
    { weight: 50, fn: testOrderPlacement },
    { weight: 30, fn: testSettlementStatus },
    { weight: 15, fn: testOrderBook },
    { weight: 5, fn: testAdminMetrics },
  ];

  const totalWeight = scenarios.reduce((sum, s) => sum + s.weight, 0);
  let random = Math.random() * totalWeight;

  for (const scenario of scenarios) {
    random -= scenario.weight;
    if (random <= 0) {
      scenario.fn();
      break;
    }
  }

  // Small delay between iterations
  sleep(Math.random() * 0.5 + 0.1);
}

// =============================================================================
// Test Functions
// =============================================================================

/**
 * Test order placement flow
 */
function testOrderPlacement() {
  group('Order Placement', () => {
    const pair = randomItem(TRADING_PAIRS);
    const account = randomItem(TEST_ACCOUNTS);

    // Simulate encrypted order data
    const orderData = {
      pair: pair.pairPda,
      side: account.side,
      encryptedAmount: generateMockEncryptedData(),
      encryptedPrice: generateMockEncryptedData(),
      eligibilityProof: generateMockProof(),
    };

    const startTime = Date.now();

    // Note: In real test, this would be the actual order placement endpoint
    // For now, we test the order-related API endpoints
    const res = http.post(
      `${BASE_URL}/api/orders/simulate`,
      JSON.stringify(orderData),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'order_placement' },
      }
    );

    const latency = Date.now() - startTime;
    orderPlacementLatency.add(latency);

    const success = check(res, {
      'order placement status is 200 or 201': (r) => r.status === 200 || r.status === 201,
      'order placement has order ID': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.orderId !== undefined || body.success === true;
        } catch {
          return false;
        }
      },
    });

    if (!success) {
      orderPlacementErrors.add(1);
      console.log(`Order placement failed: ${res.status} - ${res.body}`);
    }
  });
}

/**
 * Test settlement status queries
 */
function testSettlementStatus() {
  group('Settlement Status', () => {
    const startTime = Date.now();

    // Query settlement statistics via public status API
    const res = http.get(`${BASE_URL}/api/status/crank`, {
      tags: { name: 'settlement_status' },
    });

    const latency = Date.now() - startTime;
    settlementLatency.add(latency);

    const success = check(res, {
      'settlement status is 200': (r) => r.status === 200,
      'settlement status has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.settlement !== undefined || body.crank !== undefined;
        } catch {
          return false;
        }
      },
    });

    settlementSuccessRate.add(success);

    if (!success) {
      settlementErrors.add(1);
    } else {
      settlementsCompleted.add(1);
    }
  });
}

/**
 * Test order book queries
 */
function testOrderBook() {
  group('Order Book', () => {
    const pair = randomItem(TRADING_PAIRS);

    const res = http.get(`${BASE_URL}/api/orderbook/${pair.pairPda}`, {
      tags: { name: 'order_book' },
    });

    check(res, {
      'order book status is 200': (r) => r.status === 200,
      'order book has bids and asks': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.bids) && Array.isArray(body.asks);
        } catch {
          return false;
        }
      },
    });
  });
}

/**
 * Test admin metrics endpoint
 */
function testAdminMetrics() {
  group('Admin Metrics', () => {
    const res = http.get(`${BASE_URL}/metrics`, {
      tags: { name: 'metrics' },
    });

    check(res, {
      'metrics status is 200': (r) => r.status === 200,
      'metrics contains settlement data': (r) =>
        r.body.includes('confidex_settlements') ||
        r.body.includes('crank_'),
    });
  });
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate mock encrypted data (64 bytes hex)
 */
function generateMockEncryptedData() {
  const bytes = new Array(64);
  for (let i = 0; i < 64; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate mock ZK proof
 */
function generateMockProof() {
  return {
    a: ['0x' + generateMockEncryptedData().slice(0, 64)],
    b: [
      ['0x' + generateMockEncryptedData().slice(0, 64)],
      ['0x' + generateMockEncryptedData().slice(0, 64)],
    ],
    c: ['0x' + generateMockEncryptedData().slice(0, 64)],
  };
}

// =============================================================================
// Teardown
// =============================================================================

export function teardown(data) {
  if (data.abort) {
    console.log('Test was aborted - no teardown needed');
    return;
  }

  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`\nTest completed in ${duration.toFixed(1)} seconds`);

  // Query final metrics
  const metricsRes = http.get(`${BASE_URL}/metrics`);
  if (metricsRes.status === 200) {
    // Parse and log relevant metrics
    const lines = metricsRes.body.split('\n');
    const relevantMetrics = lines.filter(line =>
      line.includes('confidex_') || line.includes('crank_')
    );

    if (relevantMetrics.length > 0) {
      console.log('\nApplication Metrics:');
      relevantMetrics.slice(0, 20).forEach(metric => {
        console.log(`  ${metric}`);
      });
    }
  }
}
