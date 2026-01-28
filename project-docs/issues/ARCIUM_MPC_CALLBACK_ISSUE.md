# Arcium MPC Callback Not Executing After QueueComputation

**Status: RESOLVED**
**Resolution Date: 2026-01-28**
**Root Cause: Missing circuit files in GitHub Release**

## Summary

MPC computations were successfully queued via `QueueComputation` but callbacks were not being triggered. The computation would disappear from both mempool and execpool without executing the registered callback.

## Root Cause

**Missing circuit files in GitHub Release `v0.1.0-circuits`.**

The Arcium MPC nodes fetch circuit definitions (`.arcis` files) from URLs stored in the computation definition accounts. When nodes couldn't fetch the circuit file, the computation was silently dropped without executing the callback.

### Missing Circuits

The following 6 circuits were missing from the release:

| Circuit | Purpose |
|---------|---------|
| `calculate_refund.arcis` | Order cancellation refund calculation |
| `decrypt_for_settlement.arcis` | Settlement amount decryption |
| `check_balance.arcis` | Balance verification |
| `check_order_balance.arcis` | Order balance validation |
| `batch_compare_prices.arcis` | Batch price comparison |
| `batch_calculate_fill.arcis` | Batch fill amount calculation |

### How We Discovered This

1. Verified `QueueComputation` succeeded on-chain (transaction logs showed success)
2. Checked circuit URL accessibility with `curl`:
   ```bash
   # This returned HTTP 404 - circuit file missing!
   curl -sI https://github.com/Jerome2332/confidex/releases/download/v0.1.0-circuits/calculate_refund.arcis
   ```
3. Compared registered circuits with uploaded files in GitHub Release

## Resolution

### Step 1: Upload Missing Circuits

```bash
cd arcium-mxe/build
gh release upload v0.1.0-circuits \
  calculate_refund.arcis \
  decrypt_for_settlement.arcis \
  check_balance.arcis \
  check_order_balance.arcis \
  batch_compare_prices.arcis \
  batch_calculate_fill.arcis
```

### Step 2: Verify Accessibility

```bash
# All circuits should return HTTP 200
curl -sI https://github.com/Jerome2332/confidex/releases/download/v0.1.0-circuits/compare_prices.arcis | head -1
# HTTP/2 200

curl -sI https://github.com/Jerome2332/confidex/releases/download/v0.1.0-circuits/calculate_refund.arcis | head -1
# HTTP/2 200
```

### Step 3: Test End-to-End

Created test script at `frontend/scripts/test-mpc-compare-prices.ts` to verify MPC pipeline:

```bash
cd frontend && npx tsx scripts/test-mpc-compare-prices.ts
```

**Test Results:**
- Queue transaction: `3CTB6ixGE4B7WL2fBDUQ1ZzTDCreuRJV9eBRLDXLjzaZSFx6nQigvvSjUtAZkgFvcZiDUeE7ue4TZG8i4N4fwNWP`
- Callback transaction: `9FafmFBw8e4iMArJ12vzKsJvafFnvSha5ZSZTFNbbqGB4YQykZWpjAFb9VP6dBDss6C6cDJphc2hpKU68Fy4Fr6`
- End-to-end latency: ~2 seconds
- Result: `prices_match = true` (as expected for buy=$160, sell=$150)

## Verification Checklist

When MPC callbacks aren't firing, check:

- [ ] **Circuit URL accessible**: `curl -sI <circuit_url>` returns HTTP 200
- [ ] **Circuit hash matches**: Compare local `.hash` file with on-chain comp_def
- [ ] **Cluster nodes active**: `arcium list-clusters -u devnet` shows n/n nodes
- [ ] **MXE registered on cluster**: `arcium mxe-info <program_id> -u devnet`
- [ ] **Computation in mempool/execpool**: `arcium mempool <cluster> -u devnet`

## Environment

- **Network**: Solana Devnet
- **Arcium Version**: 0.6.3
- **Cluster**: 456 (2/2 nodes active)
- **MXE Program**: `4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi`

## All Registered Circuits (v0.1.0-circuits)

| Circuit | Comp Def Offset | Status |
|---------|-----------------|--------|
| `compare_prices` | 1599513934 | Working |
| `calculate_fill` | 2551234649 | Working |
| `calculate_refund` | 356918374 | Working |
| `decrypt_for_settlement` | 1205694844 | Working |
| `check_balance` | 3817161076 | Working |
| `check_order_balance` | 3612892645 | Working |
| `verify_position_params` | 3336802015 | Working |
| `calculate_liquidation` | 4109689088 | Working |
| `batch_compare_prices` | 1629959219 | Working |
| `batch_calculate_fill` | 2561987631 | Working |
| `batch_liquidation_check` | 3174766426 | Working |
| `decrypt_sealed_bid` | 1456218749 | Working |
| `generate_settlement_proof` | 3028653139 | Working |
| `verify_matching_result` | 1205694844 | Working |
| `verify_balance_lock` | 2453028166 | Working |
| `verify_fill_calculation` | 1285858336 | Working |

## Lessons Learned

1. **Silent failures are dangerous**: Arcium nodes silently drop computations when circuits can't be fetched. No error is returned to the queuing transaction.

2. **Always verify circuit accessibility**: After deploying circuits, verify each URL returns HTTP 200 before testing MPC operations.

3. **Keep circuit releases in sync**: When adding new circuits to the MXE, ensure they're also uploaded to the GitHub release.

4. **Test with direct MPC calls**: The `test-mpc-compare-prices.ts` script bypasses the full order flow and directly tests MPC, useful for isolating issues.

## Related Documentation

- [Arcium MPC Integration](../implementation/ARCIUM_MPC_INTEGRATION.md)
- [Arcium Troubleshooting](../arcium/troubleshooting.md)
- [Computation Lifecycle](../arcium/computation-lifecycle.md)

## Original Issue Details (Historical)

<details>
<summary>Click to expand original issue report</summary>

### Original Symptoms

- `QueueComputation` succeeded on-chain
- Computation account created with correct balance
- Computation not appearing in mempool/execpool
- Callback never invoked
- Order remained in `Active` status

### Original Proposed Solutions (Not Needed)

These workarounds were considered but not implemented since the root cause was found:

1. ~~Retry Logic~~ - Not needed, fix root cause instead
2. ~~UI Status Tracking~~ - Still useful for UX, but not a workaround
3. ~~Admin Cancel Fallback~~ - Not needed, MPC works correctly now

</details>
