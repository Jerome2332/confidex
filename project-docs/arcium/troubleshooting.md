# Arcium MPC Troubleshooting Guide

This guide helps diagnose and resolve common issues with Arcium MPC computations on Confidex.

## Quick Diagnostics

### Check Cluster Health

```bash
# List active clusters
arcium list-clusters -u devnet

# Expected output for cluster 456:
# Offset    Nodes    MXEs    Pending
# 456       2/2      212     0
```

If nodes show less than full (e.g., `1/2`), the cluster may not process computations reliably.

### Check MXE Registration

```bash
arcium mxe-info 4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi -u devnet
```

Verify:
- Authority matches your expected key
- Cluster offset is correct (456)
- All expected computation definition offsets are listed

### Check Computation Queues

```bash
# Check pending computations in mempool
arcium mempool 456 -u devnet

# Check executing computations
arcium execpool 456 -u devnet
```

## Common Issues

### 1. Callback Never Fires

**Symptoms:**
- `QueueComputation` transaction succeeds
- Computation account created on-chain
- Callback instruction never invoked
- Computation disappears from mempool/execpool

**Root Cause:** Circuit file not accessible

**Diagnosis:**
```bash
# Get circuit URL from comp_def account (check MXE source for URL)
CIRCUIT_URL="https://github.com/Jerome2332/confidex/releases/download/v0.1.0-circuits/compare_prices.arcis"

# Test accessibility
curl -sI "$CIRCUIT_URL" | head -1
# Expected: HTTP/2 200
# Problem: HTTP/2 404 (file missing)
```

**Solution:**
1. Upload missing circuit to GitHub release:
   ```bash
   cd arcium-mxe/build
   gh release upload v0.1.0-circuits <circuit_name>.arcis
   ```

2. Verify upload:
   ```bash
   curl -sI "$CIRCUIT_URL" | head -1
   # Should return: HTTP/2 200
   ```

3. Test with direct MPC call:
   ```bash
   cd frontend && npx tsx scripts/test-mpc-compare-prices.ts
   ```

### 2. InstructionDidNotDeserialize Error (0x66)

**Symptoms:**
```
AnchorError occurred. Error Code: InstructionDidNotDeserialize. Error Number: 102.
```

**Root Cause:** Instruction data doesn't match expected Anchor serialization format.

**Solution:**
Ensure all parameters are serialized correctly:
- Include `Option<T>` discriminator bytes (0 for None, 1 for Some)
- Use correct byte order (little-endian for integers)
- Match exact field order from Rust struct

Example fix:
```typescript
// Wrong: Missing Option discriminators
const data = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16);

// Correct: Include Option<Pubkey> discriminators
const data = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16 + 1 + 1);
// ... serialize fields ...
data[offset] = 0; // Option::None for buy_order
data[offset + 1] = 0; // Option::None for sell_order
```

### 3. ConstraintSeeds Error (0x7d6)

**Symptoms:**
```
AnchorError caused by account: sign_pda_account. Error Code: ConstraintSeeds. Error Number: 2006.
```

**Root Cause:** PDA derivation seeds don't match expected values.

**Solution:**
Use correct seed for signer PDA:
```typescript
// Wrong seed
const SIGN_PDA_SEED = Buffer.from('ArciumSignerPDA');

// Correct seed
const SIGN_PDA_SEED = Buffer.from('ArciumSignerAccount');

const [signPdaAccount] = PublicKey.findProgramAddressSync(
  [SIGN_PDA_SEED],
  MXE_PROGRAM_ID
);
```

### 4. AlreadyCallbackedComputation Error (0x183c)

**Symptoms:**
```
Error Code: AlreadyCallbackedComputation. Error Number: 6204.
```

**Root Cause:** The callback was already executed for this computation. Multiple nodes may race to submit the callback.

**Solution:**
This is normal behavior when multiple nodes attempt the callback. The first succeeds, subsequent attempts fail with this error. No action needed.

### 5. Computation Stuck in Mempool

**Symptoms:**
- Computation visible in mempool for extended period
- Not moving to execpool
- Cluster shows nodes active

**Possible Causes:**
1. Circuit file inaccessible
2. Cluster nodes not synced
3. Network congestion

**Diagnosis:**
```bash
# Check if computation is still there
arcium mempool 456 -u devnet

# Verify circuit accessibility
curl -sI <circuit_url> | head -1

# Check cluster node status
arcium list-clusters -u devnet
```

## Circuit Deployment Checklist

When deploying new circuits:

1. **Build circuits:**
   ```bash
   cd arcium-mxe/encrypted-ixs
   arcup build
   ```

2. **Copy to build directory:**
   ```bash
   cp target/*.arcis ../build/
   cp target/*.hash ../build/
   ```

3. **Upload to GitHub Release:**
   ```bash
   cd ../build
   gh release upload v0.1.0-circuits *.arcis
   ```

4. **Verify all circuits accessible:**
   ```bash
   for circuit in compare_prices calculate_fill calculate_refund; do
     echo -n "$circuit: "
     curl -sI "https://github.com/Jerome2332/confidex/releases/download/v0.1.0-circuits/${circuit}.arcis" | head -1
   done
   ```

5. **Deploy comp_def accounts:**
   ```bash
   arcium deploy-comp-def <circuit_name> --url <circuit_url> -u devnet
   ```

6. **Test end-to-end:**
   ```bash
   cd frontend && npx tsx scripts/test-mpc-compare-prices.ts
   ```

## Monitoring Commands

### Real-time MXE Program Logs

```bash
solana logs 4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi -u devnet
```

### Recent Transactions

```bash
curl -s https://api.devnet.solana.com -X POST -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getSignaturesForAddress",
  "params": ["4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi", {"limit": 10}]
}' | jq '.result[].signature'
```

### Transaction Details

```bash
solana confirm -v <signature> -u devnet
```

## Testing MPC Directly

Use the test script to bypass the full order flow:

```bash
cd frontend
npx tsx scripts/test-mpc-compare-prices.ts
```

This script:
1. Encrypts test buy/sell prices
2. Queues `compare_prices` computation
3. Waits for callback

Expected output on success:
```
Queue transaction: <signature>
Callback fires with PriceCompareResult event
prices_match = true (if buy >= sell)
```

## Program IDs Reference

| Program | Address |
|---------|---------|
| Confidex DEX | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` |
| Confidex MXE | `4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi` |
| Arcium Core | `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ` |

## Getting Help

If issues persist:

1. Check [Arcium Discord](https://discord.gg/arcium) for known issues
2. Review transaction logs for specific error codes
3. Compare against working implementations in `frontend/scripts/`
4. File issue in project repository with:
   - Transaction signature
   - Full error logs
   - Circuit name and comp_def offset
   - Steps to reproduce
