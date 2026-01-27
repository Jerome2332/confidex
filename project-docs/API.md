# Confidex Backend API Documentation

This document describes all available API endpoints for the Confidex backend service.

## Base URL

- **Development**: `http://localhost:3001`
- **Production**: `https://api.confidex.xyz`

## Authentication

Most public endpoints do not require authentication. Admin endpoints require an API key passed via the `X-API-Key` header.

## Rate Limiting

| Environment | Standard Limit | Admin Limit |
|-------------|----------------|-------------|
| Production | 100 req/min | 10 req/min |
| Development | 500 req/min | 10 req/min |

Rate limit headers are included in all responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## Health & Monitoring

### GET /health/ready

Check if the service is ready to accept requests.

**Response**
```json
{
  "status": "ready",
  "rpc": "healthy",
  "database": "healthy"
}
```

### GET /health/live

Basic liveness check.

**Response**
```json
{
  "status": "ok"
}
```

### GET /metrics

Prometheus-formatted metrics for monitoring.

**Response**: Prometheus text format

---

## Public Status API

### GET /api/status

Get overall system status summary.

**Response**
```json
{
  "status": "operational",
  "services": {
    "crank": "running",
    "settlement": "legacy",
    "mpc": "enabled"
  },
  "metrics": {
    "openOrders": 16,
    "pendingMatches": 0,
    "successRate": "100.0%"
  },
  "timestamp": 1769527405855
}
```

### GET /api/status/crank

Get detailed crank service status and metrics.

**Response**
```json
{
  "status": "running",
  "crank": {
    "status": "running",
    "isRunning": true,
    "metrics": {
      "totalPolls": 1234,
      "totalMatchAttempts": 56,
      "successfulMatches": 54,
      "failedMatches": 2,
      "openOrderCount": 16,
      "pendingMatches": 0
    },
    "uptime": 3600000,
    "lastPoll": 1769527400000
  },
  "settlement": {
    "enabled": true,
    "method": "legacy"
  },
  "timestamp": 1769527405855
}
```

### GET /api/status/settlement

Get settlement system statistics.

**Response**
```json
{
  "settlement": {
    "enabled": true,
    "method": "shadowwire",
    "metrics": {
      "matchAttempts": 56,
      "successfulMatches": 54,
      "failedMatches": 2,
      "successRate": "96.43"
    }
  },
  "timestamp": 1769527405855
}
```

### GET /api/status/rpc

Get RPC connection health status.

**Response**
```json
{
  "rpc": {
    "status": "healthy",
    "endpoints": [
      {
        "url": "https://api.devnet.solana.com",
        "isHealthy": true,
        "isCurrent": true,
        "latencyMs": 45
      }
    ],
    "blockhash": {
      "cacheSize": 5,
      "currentSlot": 123456789
    }
  },
  "timestamp": 1769527405855
}
```

---

## Order Book API

### GET /api/orderbook

List all available trading pairs.

**Response**
```json
{
  "pairs": [
    {
      "pda": "3WRnHKvVgyZKXk9roscEkq4xaG62Uc7vhjAhd5zUZ5vV",
      "baseMint": "So11111111111111111111111111111111111111112",
      "quoteMint": "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
      "baseSymbol": "SOL",
      "quoteSymbol": "USDC",
      "status": "active"
    }
  ],
  "count": 1,
  "timestamp": 1769527405855
}
```

### GET /api/orderbook/:pair

Get privacy-preserving order book for a trading pair. Returns order counts only (no amounts or prices).

**Parameters**
- `pair` (path): Trading pair PDA address

**Response**
```json
{
  "pair": "3WRnHKvVgyZKXk9roscEkq4xaG62Uc7vhjAhd5zUZ5vV",
  "timestamp": 1769527439098,
  "bids": [
    { "count": 9, "depth": 9 }
  ],
  "asks": [
    { "count": 7, "depth": 7 }
  ],
  "totalBids": 9,
  "totalAsks": 7,
  "lastUpdate": 1769527439098
}
```

### GET /api/orderbook/:pair/summary

Get a summary of the order book for a trading pair.

**Response**
```json
{
  "pair": "3WRnHKvVgyZKXk9roscEkq4xaG62Uc7vhjAhd5zUZ5vV",
  "status": "active",
  "timestamp": 1769527405855,
  "summary": {
    "hasOrders": true,
    "lastActivity": 1769527405855,
    "tradingEnabled": true
  }
}
```

---

## Orders API

### POST /api/orders/simulate

Simulate an order placement without executing on-chain. Useful for validation and gas estimation.

**Request Body**
```json
{
  "pair": "3WRnHKvVgyZKXk9roscEkq4xaG62Uc7vhjAhd5zUZ5vV",
  "side": "buy",
  "encryptedAmount": "aabbccdd...",
  "encryptedPrice": "11223344...",
  "eligibilityProof": {
    "a": ["0x..."],
    "b": [["0x..."], ["0x..."]],
    "c": ["0x..."]
  }
}
```

**Fields**
- `pair` (string, required): Trading pair PDA (32-64 chars)
- `side` (string, required): Order side - `"buy"` or `"sell"`
- `encryptedAmount` (string, required): Hex-encoded encrypted amount (min 64 chars)
- `encryptedPrice` (string, required): Hex-encoded encrypted price (min 64 chars)
- `eligibilityProof` (object, optional): ZK eligibility proof

**Response**
```json
{
  "success": true,
  "orderId": "SIM4725662119c000def0b",
  "estimatedGas": 252560,
  "validUntil": 1769527739115,
  "warnings": [
    "No eligibility proof provided - order may be rejected on-chain"
  ]
}
```

### GET /api/orders/:orderId

Get order details by order ID (PDA).

**Response**
```json
{
  "orderId": "HtgoGQbnzm5V...",
  "status": "lookup_required",
  "message": "Order details must be fetched from on-chain data",
  "hint": "Use RPC getAccountInfo with the order PDA"
}
```

---

## Proof Generation API

### POST /api/prove

Generate a ZK eligibility proof.

**Request Body**
```json
{
  "walletAddress": "9KeKSyGNJrY7Vu9NXznWyt8mhxTm7m7AyDM4faE93zo2",
  "merkleRoot": "0x..."
}
```

**Response**
```json
{
  "proof": {
    "a": ["0x..."],
    "b": [["0x..."], ["0x..."]],
    "c": ["0x..."]
  },
  "publicInputs": ["0x..."],
  "cached": false
}
```

---

## Admin API

All admin endpoints require authentication via `X-API-Key` header.

### GET /api/admin/crank/status

Get crank service status (admin version with full details).

### POST /api/admin/crank/start

Start the crank service.

### POST /api/admin/crank/stop

Stop the crank service.

### POST /api/admin/crank/pause

Pause the crank service (stops polling but keeps state).

### POST /api/admin/crank/resume

Resume the crank service after pause.

### POST /api/admin/crank/skip-pending-mpc

Skip all pending MPC computations.

### GET /api/admin/blacklist

Get the current blacklist.

### POST /api/admin/blacklist/add

Add an address to the blacklist.

### POST /api/admin/blacklist/remove

Remove an address from the blacklist.

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "error": "Error Type",
  "message": "Detailed error message",
  "details": ["Optional array of specific issues"]
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing or invalid API key |
| 403 | Forbidden - CORS or permission error |
| 404 | Not Found - Endpoint or resource not found |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable - Dependency not ready |

---

## WebSocket API

When enabled (`STREAMING_ENABLED=true`), real-time updates are available via WebSocket.

**Endpoint**: `ws://localhost:3001/ws`

### Subscription Topics

- `orderbook:{pair}` - Order book updates
- `orders:{wallet}` - Order status updates for a wallet
- `settlements` - Settlement events

### Message Format

```json
{
  "type": "orderbook_update",
  "topic": "orderbook:3WRnHKv...",
  "data": {
    "pair": "3WRnHKv...",
    "bids": 10,
    "asks": 8,
    "timestamp": 1769527405855
  }
}
```

---

## Load Testing

For load testing, start the backend with `LOAD_TEST_MODE=true` to increase rate limits to 5000 req/min.

```bash
LOAD_TEST_MODE=true pnpm dev
```

See [tests/load/README.md](../tests/load/README.md) for load testing documentation.
