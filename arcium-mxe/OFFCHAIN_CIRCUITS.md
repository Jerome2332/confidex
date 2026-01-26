# Offchain Circuit Storage Implementation

**Status: ✅ COMPLETE (2026-01-20)**

## Background

Arcis-compiled circuits are large (14MB total for Confidex). Storing them on-chain is prohibitively expensive (~100 SOL). The Arcium documentation recommends offchain storage.

## Implementation Status

| Step | Status | Notes |
|------|--------|-------|
| Update MXE program with `CircuitSource::OffChain` | ✅ Done | Uses `circuit_hash!` macro |
| Upload circuits to public storage | ✅ Done | GitHub Releases v0.1.0-circuits |
| Deploy updated MXE | ✅ Done | `4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi` |
| Initialize comp defs | ✅ Done | All 10 circuits registered |
| MXE keygen complete | ✅ Done | X25519 key: `14706bf82ff9e9cebde9d7ad1cc35dc98ad11b08ac92b07ed0fe472333703960` |
| Update program IDs in codebase | ✅ Done | Frontend + DEX updated |
| DEX program redeployed | ✅ Done | Slot 436479951 |

## Deployment Details

**MXE Program ID:** `4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi`
**DEX Program ID:** `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB`
**Cluster:** 456 (Arcium v0.6.3 devnet)
**Circuit Storage:** https://github.com/Jerome2332/confidex/releases/tag/v0.1.0-circuits

## Required Changes

### 1. Upload Circuit Files to Public Storage

Upload all `.arcis` files from `build/` to a publicly accessible location:

**Options:**
- **IPFS via web3.storage** (free, decentralized, recommended)
- **S3 with public-read bucket**
- **Supabase object storage**
- **GitHub Releases** (simple, versioned)

Files to upload:
- `compare_prices.arcis` (767 KB)
- `calculate_fill.arcis` (905 KB)
- `verify_position_params.arcis` (1.2 MB)
- `check_liquidation.arcis` (733 KB)
- `batch_liquidation_check.arcis` (1.4 MB)
- `calculate_pnl.arcis` (5.6 MB)
- `calculate_funding.arcis` (1.9 MB)
- `add_encrypted.arcis` (786 KB)
- `sub_encrypted.arcis` (798 KB)
- `mul_encrypted.arcis` (786 KB)

### 2. Modify MXE Program to Use Offchain Sources

Update each `init_*_comp_def` function in `programs/confidex_mxe/src/lib.rs`:

**Before:**
```rust
pub fn init_compare_prices_comp_def(ctx: Context<InitComparePricesCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    Ok(())
}
```

**After:**
```rust
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

pub fn init_compare_prices_comp_def(ctx: Context<InitComparePricesCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://your-storage.com/circuits/compare_prices.arcis".to_string(),
            hash: circuit_hash!("compare_prices"),
        })),
        None,
    )?;
    Ok(())
}
```

Repeat for all 10 circuits.

### 3. Update Cargo.toml (if needed)

Ensure `arcium-macros` is imported for the `circuit_hash!` macro:
```toml
[dependencies]
arcium-macros = "=0.6.3"
```

### 4. Rebuild MXE

```bash
cd arcium-mxe
arcium build
```

### 5. Deploy Updated MXE

Since computation definitions are already initialized on-chain, we need to:

**Option A:** Deploy to a new program address
```bash
arcium deploy --cluster-offset 456 --recovery-set-size 4 \
  --keypair-path ~/.config/solana/devnet.json \
  --rpc-url https://devnet.helius-rpc.com/?api-key=<key>
```
Then update `NEXT_PUBLIC_MXE_PROGRAM_ID` everywhere.

**Option B:** Try to update existing program (if possible)
- Arcium may allow re-initializing comp defs with offchain sources
- Check Arcium docs or contact team

### 6. Re-initialize Computation Definitions

If deploying to new address, run the init script:
```bash
cd arcium-mxe
npx tsx scripts/init-comp-defs.ts
```

The comp def accounts will now contain offchain circuit references instead of expecting on-chain bytecode.

### 7. Verify

Arx nodes will:
1. Read the offchain URL from comp_def_account
2. Fetch the circuit from the URL
3. Verify SHA-256 hash matches `circuit_hash!` value
4. Execute computation

## Storage URL Format

Example URLs after upload:
```
https://ipfs.io/ipfs/<CID>/compare_prices.arcis
https://w3s.link/ipfs/<CID>/compare_prices.arcis
https://s3.us-east-1.amazonaws.com/confidex-circuits/compare_prices.arcis
```

## Hash Verification

The `circuit_hash!` macro reads from `build/{circuit_name}.hash` which contains the SHA-256 hash of the compiled circuit. Arx nodes verify this hash when fetching to ensure the circuit hasn't been tampered with.

**IMPORTANT:** Always use `circuit_hash!("circuit_name")` - never use placeholder hashes like `[0u8; 32]`.

## Cost Comparison

| Approach | Cost | Notes |
|----------|------|-------|
| On-chain bytecode | ~100 SOL | 14MB × ~0.007 SOL/KB |
| Offchain storage | ~0 SOL | Free IPFS or minimal S3 |
| Comp def init | ~0.01 SOL | Same either way |

## Timeline

1. Upload circuits to storage (10 min)
2. Update MXE program (30 min)
3. Rebuild with `arcium build` (5 min)
4. Deploy updated program (5 min)
5. Re-init comp defs (5 min)
6. Verify end-to-end (30 min)

Total: ~90 minutes
