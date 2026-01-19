# Helius getTransactionsForAddress API

> Helius-exclusive RPC method for querying Solana transaction history with advanced filtering, bidirectional sorting, and efficient pagination.

**Source:** https://www.helius.dev/docs/rpc/gettransactionsforaddress

## Overview

`getTransactionsForAddress` is a Helius-exclusive RPC method that solves a critical Solana UX problem: wallets don't hold tokens directly—they own token accounts (ATAs) which hold tokens. Standard RPC methods like `getSignaturesForAddress` miss transactions that only reference token accounts.

### Key Problem Solved

```
Standard RPC (getSignaturesForAddress):
  - Only returns transactions directly referencing wallet address
  - Misses transactions that only touch ATAs
  - Requires multiple calls + merging for complete history

Helius (getTransactionsForAddress):
  - Single query for wallet's entire history including ATAs
  - "balanceChanged" filter excludes noise (fee collections, delegations)
  - Full transaction data in one call
```

## Requirements

| Requirement | Value |
|-------------|-------|
| Plan | Developer plan or higher |
| Cost | 100 credits per request |
| Limits | 100 full transactions OR 1,000 signatures per request |

## Network Support

| Network | Supported | Retention Period |
|---------|-----------|------------------|
| Mainnet | Yes | Unlimited |
| Devnet | Yes | 2 weeks |
| Testnet | No | N/A |

## Core Parameters

```typescript
interface GetTransactionsForAddressParams {
  // Required: Base-58 encoded public key
  address: string;

  // Optional configuration
  options?: {
    // "signatures" (faster) or "full" (complete data)
    transactionDetails?: "signatures" | "full";

    // "desc" (newest first) or "asc" (oldest first)
    sortOrder?: "desc" | "asc";

    // Max results: 1000 for signatures, 100 for full
    limit?: number;

    // Format: "slot:position" from previous response
    paginationToken?: string;

    // "finalized" or "confirmed" (no "processed")
    commitment?: "finalized" | "confirmed";

    // Advanced filters
    filters?: {
      // Slot range filtering
      slot?: { gte?: number; gt?: number; lte?: number; lt?: number };

      // Unix timestamp filtering
      blockTime?: { gte?: number; gt?: number; lte?: number; lt?: number; eq?: number };

      // Signature-based filtering
      signature?: { gte?: string; gt?: string; lte?: string; lt?: string };

      // Transaction status
      status?: "succeeded" | "failed" | "any";

      // Token account inclusion (THE KEY FEATURE)
      tokenAccounts?: "none" | "balanceChanged" | "all";
    };

    // For full mode: "json" | "jsonParsed" | "base64" | "base58"
    encoding?: string;

    // Set to 0 to include versioned transactions
    maxSupportedTransactionVersion?: number;
  };
}
```

## Token Accounts Filter (Critical Feature)

This is the most important parameter for Confidex:

| Value | Behavior | Use Case |
|-------|----------|----------|
| `"none"` (default) | Only transactions directly referencing wallet | Basic wallet queries |
| `"balanceChanged"` **(recommended)** | Wallet + ATA balance changes, excludes noise | **Trade history, settlements** |
| `"all"` | Wallet + all ATA transactions | Complete audit trail |

### Why `balanceChanged` is Recommended

- **Includes:** Token transfers, swaps, settlements to ATAs
- **Excludes:** Fee collections, delegations, rent operations, spam
- **Result:** Clean view of meaningful wallet activity

## Response Formats

### Signatures Mode (Faster)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "data": [
      {
        "signature": "5h6xBEauJ3PK...",
        "slot": 1054,
        "transactionIndex": 42,
        "err": null,
        "memo": null,
        "blockTime": 1641038400,
        "confirmationStatus": "finalized"
      }
    ],
    "paginationToken": "1055:5"
  }
}
```

### Full Mode (Complete Data)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "data": [
      {
        "slot": 1054,
        "transactionIndex": 42,
        "blockTime": 1641038400,
        "transaction": {
          "signatures": ["5h6xBEauJ3PK..."],
          "message": {
            "accountKeys": ["...", "..."],
            "instructions": [...]
          }
        },
        "meta": {
          "fee": 5000,
          "preBalances": [1000000, 2000000],
          "postBalances": [999995000, 2000000]
        }
      }
    ],
    "paginationToken": "1055:5"
  }
}
```

### Response Fields

| Field | Type | Mode | Description |
|-------|------|------|-------------|
| `signature` | string | signatures | Transaction signature (base-58) |
| `slot` | number | both | Block slot number |
| `transactionIndex` | number | both | Zero-based index within block (exclusive to this API) |
| `blockTime` | number \| null | both | Unix timestamp (seconds) |
| `err` | object \| null | signatures | Error if failed, null if success |
| `memo` | string \| null | signatures | Associated memo |
| `confirmationStatus` | string | signatures | Cluster confirmation status |
| `transaction` | object | full | Complete transaction data |
| `meta` | object | full | Transaction metadata (fees, balances) |
| `paginationToken` | string \| null | both | Token for next page, null if done |

## Usage Examples

### Basic Query with Token Account History

```typescript
const response = await fetch('https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransactionsForAddress',
    params: [
      'WALLET_ADDRESS',
      {
        transactionDetails: 'full',
        sortOrder: 'asc',
        limit: 100,
        filters: {
          tokenAccounts: 'balanceChanged'
        }
      }
    ]
  })
});
```

### Time-Bounded Query

```typescript
const startTime = Math.floor(new Date('2025-01-01').getTime() / 1000);
const endTime = Math.floor(new Date('2025-02-01').getTime() / 1000);

const params = [
  'WALLET_ADDRESS',
  {
    transactionDetails: 'full',
    sortOrder: 'asc',
    filters: {
      blockTime: { gte: startTime, lt: endTime },
      status: 'succeeded',
      tokenAccounts: 'balanceChanged'
    }
  }
];
```

### Pagination Pattern

```typescript
async function getAllTransactions(address: string) {
  const allTransactions = [];
  let paginationToken: string | null = null;

  do {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransactionsForAddress',
        params: [
          address,
          {
            transactionDetails: 'signatures',
            limit: 1000,
            filters: { tokenAccounts: 'balanceChanged' },
            ...(paginationToken && { paginationToken })
          }
        ]
      })
    });

    const data = await response.json();
    allTransactions.push(...data.result.data);
    paginationToken = data.result.paginationToken;
  } while (paginationToken);

  return allTransactions;
}
```

### Multiple Addresses (Parallel Queries)

```typescript
const addresses = ['Address1...', 'Address2...', 'Address3...'];

const results = await Promise.all(
  addresses.map(address =>
    fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransactionsForAddress',
        params: [address, {
          sortOrder: 'desc',
          filters: {
            tokenAccounts: 'balanceChanged',
            slot: { gt: 250000000 }
          }
        }]
      })
    }).then(r => r.json())
  )
);

// Merge and sort by slot
const allTransactions = results
  .flatMap(r => r.result.data)
  .sort((a, b) => b.slot - a.slot);
```

## Comparison: Old vs New Approach

### Old Way (getSignaturesForAddress)

```typescript
// Step 1: Get all token accounts
const tokenAccounts = await connection.getTokenAccountsByOwner(
  new PublicKey(walletAddress),
  { programId: TOKEN_PROGRAM_ID }
);

// Step 2: Fetch signatures for wallet
const walletSignatures = await connection.getSignaturesForAddress(
  new PublicKey(walletAddress),
  { limit: 1000 }
);

// Step 3: Fetch signatures for EVERY token account (painful)
const tokenAccountSignatures = await Promise.all(
  tokenAccounts.value.map(account =>
    connection.getSignaturesForAddress(account.pubkey, { limit: 1000 })
  )
);

// Step 4: Merge all results
const allSignatures = [
  ...walletSignatures,
  ...tokenAccountSignatures.flat()
];

// Step 5: Deduplicate
const seen = new Set();
const uniqueSignatures = allSignatures.filter(sig => {
  if (seen.has(sig.signature)) return false;
  seen.add(sig.signature);
  return true;
});

// Step 6: Sort chronologically
const sortedSignatures = uniqueSignatures.sort((a, b) => a.slot - b.slot);

// Step 7: Get full transaction data (100+ additional calls!)
const transactions = await Promise.all(
  sortedSignatures.map(sig => connection.getTransaction(sig.signature))
);
```

### New Way (getTransactionsForAddress)

```typescript
const response = await fetch(heliusRpcUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransactionsForAddress',
    params: [
      walletAddress,
      {
        transactionDetails: 'full',
        sortOrder: 'asc',
        limit: 100,
        filters: { tokenAccounts: 'balanceChanged' }
      }
    ]
  })
});

const { result } = await response.json();
// Done! Complete history with full transaction data
```

## Confidex Integration Benefits

### 1. Complete MPC Settlement Tracking

When Arcium MPC settles a trade by transferring tokens directly to user's ATA:
- **Old:** Wallet history shows nothing (transaction only touched ATA)
- **New:** Full visibility via `tokenAccounts: "balanceChanged"`

### 2. C-SPL Confidential Transfer Visibility

Confidential token operations may only touch token accounts, not the wallet directly. Now captured.

### 3. Clean Trade History

The `"balanceChanged"` filter excludes:
- Token extension fee collections
- Delegation changes
- Account rent operations
- Spam transactions

Result: Only meaningful wallet activity (trades, transfers, settlements).

### 4. Simplified Implementation

Replace our current two-step approach:
```typescript
// Before: Multiple queries
const signatures = await getSignaturesForAddress(wallet);
const parsedTxs = await parseTransactions(signatures);
// Still might miss ATA-only transactions!

// After: Single query, complete history
const fullHistory = await getTransactionsForAddress(wallet, {
  transactionDetails: 'full',
  filters: { tokenAccounts: 'balanceChanged' }
});
```

### 5. Better Pagination

New `paginationToken` format (`"slot:position"`) is more reliable than signature-based pagination for high-throughput scenarios.

### 6. Time-Based Filtering

Filter by `blockTime` ranges for:
- "Trades in last 24h"
- "This session's activity"
- Monthly/weekly reports

## Integration Checklist for Confidex

- [ ] Update `frontend/src/lib/helius-client.ts` with new `getTransactionsForAddress` function
- [ ] Update `frontend/src/hooks/use-trade-history.ts` to use new API
- [ ] Add `tokenAccounts: 'balanceChanged'` filter for complete settlement visibility
- [ ] Implement proper pagination with `paginationToken`
- [ ] Add time-based filtering for analytics
- [ ] Test on devnet (2-week retention limit)
- [ ] Verify MPC callback transactions are captured via ATA filter

## Best Practices

### Performance
- Use `transactionDetails: "signatures"` when full data not needed
- Implement reasonable page sizes
- Use time/slot filters for targeted queries

### Filtering
- Start with `tokenAccounts: "balanceChanged"` (recommended default)
- Add `status: "succeeded"` to exclude failed transactions
- Use time filters for analytics workflows

### Pagination
- Store pagination tokens for resumable large queries
- Monitor pagination depth for performance planning
- Use ascending order for historical replay

### Error Handling
- Handle rate limits with exponential backoff
- Validate addresses before requests
- Cache results when appropriate

## References

- **API Docs:** https://www.helius.dev/docs/rpc/gettransactionsforaddress
- **Helius Dashboard:** https://dashboard.helius.dev/api-keys
- **Discord:** https://discord.com/invite/6GXdee3gBj
- **Full Docs Index:** https://www.helius.dev/docs/llms.txt
