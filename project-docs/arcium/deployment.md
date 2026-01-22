# Deployment

## Getting Started with Deployment

So you've built and tested your MXE locally, and now you're ready to deploy it to Solana devnet. This guide will walk you through the deployment process and share some tips to make it go smoothly.

## What You'll Need

Before we dive into deployment, let's make sure you have everything ready:

* Your MXE built successfully with `arcium build`
* Tests passing locally with `arcium test`
* A Solana keypair with around 2-5 SOL for deployment costs (program deployment and account initialization)
* Access to a reliable RPC endpoint

**Warning:** RPC reliability is critical for deployment. Default Solana devnet endpoints frequently drop transactions, causing deployment failures. Get a free API key from [Helius](https://helius.dev) or [QuickNode](https://quicknode.com) before attempting deployment.

## Preparing Your Program

Before you deploy, there are a couple of important things to consider about how your program handles computation definitions.

### Handling Large Circuits with Offchain Storage

Here's something important to know: right now, Arcis compiled circuits are not optimally efficient with their encoding, which means your circuit files can easily be several MBs in size. That makes initializing computation definitions onchain pretty expensive - and will require a lot of transactions to fully upload.

The good news is you can store your circuits offchain instead. Just upload them to IPFS, a public S3 bucket, or even Supabase object storage - wherever works for you. Here's how to update your program to use offchain storage:

**Standard approach (works for small circuits):**

```rust
pub fn init_add_together_comp_def(ctx: Context<InitAddTogetherCompDef>) -> Result<()> {
    // This initializes the computation definition account
    init_comp_def(ctx.accounts, None, None)?;
    Ok(())
}
```

**Offchain approach (recommended for larger circuits):**

```rust
// First, import the types you'll need
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

pub fn init_add_together_comp_def(ctx: Context<InitAddTogetherCompDef>) -> Result<()> {
    // Point to your uploaded circuit file
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://your-storage.com/path/to/add_together.arcis".to_string(),
            hash: circuit_hash!("add_together"),
        })),
        None,
    )?;
    Ok(())
}
```

**Note:** The `circuit_hash!` macro embeds the SHA-256 hash of your compiled circuit at compile time. The hash is read from `build/{circuit_name}.hash`, which is generated automatically during `arcium build`. Arx nodes verify this hash when fetching your circuit to ensure the circuit hasn't been tampered with.

**Important:** Always use `circuit_hash!` for offchain circuits. Don't use a placeholder like `[0u8; 32]` - this will cause verification to fail on Arx nodes.

With the offchain approach, you'll:

1. Build your project with `arcium build` to generate the circuit files and hashes
2. Upload the `.arcis` files from `build/` folder to your preferred storage service
3. Update your init functions with the public URLs and `circuit_hash!` macro calls

Note: Your circuit files must be publicly accessible without authentication. Make sure your storage service allows public read access.

This saves a ton on transaction costs and lets you work with much larger circuits!

### Note on Cluster Configuration

When testing locally, you've been using `arciumEnv.arciumClusterOffset` with `getClusterAccAddress()` in your test code. For devnet deployment, you'll use the same pattern with your chosen cluster offset - we'll show you exactly how in the post-deployment section.

## Basic Deployment

The `arcium deploy` command handles both deploying your program and initializing the MXE account. Here's the basic command structure:

```bash
arcium deploy --cluster-offset <cluster-offset> --recovery-set-size <size> --keypair-path <path-to-your-keypair> --rpc-url <your-rpc-url>
```

Let's break down what each parameter does:

### Understanding Cluster Offsets

The `--cluster-offset` tells your MXE which Arcium cluster it should connect to. Think of clusters as groups of nodes that will perform your encrypted computations. For devnet:

* `456` - v0.6.3 (recommended, 2/2 nodes)

**Important:** Cluster 123 is mentioned in older Arcium documentation but does NOT exist on devnet. Always use cluster 456.

### Recovery Set Size

The `--recovery-set-size` parameter specifies the number of nodes required for threshold cryptography recovery operations. This is a required parameter. For devnet, use `4`.

### Choosing Your RPC Provider

The `--rpc-url` parameter is particularly important. While you could use Solana's default RPC endpoints with the shorthand notation (`-u d` for devnet), the default RPC can be unreliable and cause deployment failures due to dropped transactions.

**Recommended approach with a reliable RPC:**

```bash
arcium deploy --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url https://devnet.helius-rpc.com/?api-key=<your-api-key>
```

**If you must use the default RPC:**

```bash
arcium deploy --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  -u d  # 'd' for devnet, 't' for testnet, 'l' for localnet
```

Just be prepared for potential transaction failures with the default RPC.

## Advanced Deployment Options

Once you're comfortable with basic deployment, you might want to customize things further.

### Adjusting Mempool Size

The mempool determines how many computations your MXE can queue up. The default "Tiny" size works fine for testing, but you might want more capacity for production:

```bash
arcium deploy --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url <your-rpc-url> \
  --mempool-size Medium
```

Available sizes are: `Tiny`, `Small`, `Medium`, `Large`. Start small and increase if you need more capacity.

### Using a Custom Program Address

If you need your program at a specific address (maybe for consistency across deployments), you can provide a program keypair:

```bash
arcium deploy --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url <your-rpc-url> \
  --program-keypair ./program-keypair.json
```

### Partial Deployments

Sometimes you might need to run just part of the deployment process. For instance, if you've already deployed the program but need to reinitialize the MXE account:

```bash
# Skip program deployment, only initialize MXE account
arcium deploy --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url <your-rpc-url> \
  --skip-deploy
```

Or if you only want to deploy the program without initialization:

```bash
# Deploy program only, skip MXE initialization
arcium deploy --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url <your-rpc-url> \
  --skip-init
```

## After Deployment

### Verify DKG Completion

After `arcium deploy` completes, the MXE account is created and Distributed Key Generation (DKG) begins automatically. The DKG process generates the shared X25519 encryption key used by your MXE.

**Check DKG status:**

```bash
arcium mxe-info <your-mxe-program-id> -u devnet
```

Look for:
- `x25519_public_key`: Should be a 64-character hex string (not zeros)
- If the key shows all zeros, DKG is not yet complete

**Typical DKG completion time:** 1-5 minutes on devnet cluster 456.

**What if DKG is stuck?**

If DKG doesn't complete after 10+ minutes:

```bash
# Check if stuck in execpool
arcium requeue-mxe-keygen <your-mxe-program-id> -u devnet

# If that fails, deploy a fresh MXE with a new keypair
solana-keygen new -o new-mxe-keypair.json
arcium deploy --cluster-offset 456 --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --program-keypair new-mxe-keypair.json \
  --rpc-url <your-rpc-url>
```

### Initialize Your Computation Definitions

Your MXE is deployed, but you still need to initialize the computation definitions. This tells the Arcium network what encrypted operations your MXE can perform. Computation definitions only need to be initialized once - they persist onchain and don't need to be re-initialized unless you're deploying to a new program address. You can initialize them anytime after deployment completes successfully.

Remember how we mentioned you'd need to update your cluster configuration? Now's the time! You'll need to update your test or client code to derive the cluster account (and the related PDAs) from the cluster offset you selected during deployment.

**Local testing pattern:**

```typescript
const arciumEnv = getArciumEnv();

// In your transaction...
.accountsPartial({
    computationAccount: getComputationAccAddress(
        arciumEnv.arciumClusterOffset,
        computationOffset
    ),
    clusterAccount: getClusterAccAddress(arciumEnv.arciumClusterOffset),
    mxeAccount: getMXEAccAddress(program.programId),
    mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
    executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
    // ... other accounts
})
```

**For devnet deployment:**

```typescript
// Use the cluster offset from your deployment (e.g., 456)
const clusterOffset = 456;

// In your transaction...
.accountsPartial({
    computationAccount: getComputationAccAddress(clusterOffset, computationOffset),
    clusterAccount: getClusterAccAddress(clusterOffset),
    mxeAccount: getMXEAccAddress(program.programId),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    // ... other accounts
})
```

Make sure to use the same `cluster_offset` value that you used during deployment! This ensures your program talks to the right cluster.

Once you've updated the cluster configuration, you can run the initialization:

```typescript
// Now with the correct cluster configured
await initAddTogetherCompDef(program, owner, false);
```

### Verify Everything's Working

Let's make sure your deployment succeeded:

```bash
solana program show <your-program-id> --url <your-rpc-url>
```

To run your tests against the deployed program on devnet, you'll need to update your test setup code to use devnet configuration instead of the local testing environment:

```typescript
// Update your test setup to use devnet when needed
const useDevnet = true; // Set to false for local testing

if (useDevnet) {
  // Devnet configuration
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com", // or your preferred RPC
    "confirmed"
  );
  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new anchor.Program<YourProgram>(IDL as anchor.Idl, provider);
  const clusterOffset = 456; // Use your cluster offset
  const clusterAccount = getClusterAccAddress(clusterOffset);
} else {
  // Local configuration
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.YourProgram as Program<YourProgram>;
  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);
}
```

Then run your tests with:

```bash
arcium test
```

## Common Issues and Solutions

### Dealing with Dropped Transactions

If your deployment fails with transaction errors, it's almost always the RPC. Switch to a dedicated provider:

```bash
# Instead of this (unreliable):
arcium deploy ... -u d

# Use this (reliable):
arcium deploy ... --rpc-url https://devnet.helius-rpc.com/?api-key=<your-key>
```

### Running Out of SOL

Check your balance before deploying:

```bash
solana balance <your-keypair-pubkey> -u devnet
```

Need more devnet SOL? Request an airdrop:

```bash
solana airdrop 2 <your-keypair-pubkey> -u devnet
```

### Deployment Partially Failed?

No worries, you can complete the missing steps. If the program deployed but initialization failed, just run with `--skip-deploy`. If initialization succeeded but deployment failed, use `--skip-init`.

## What's Next?

With your MXE deployed, you're ready to:

1. Update your client code to connect to the deployed program
2. Initialize all your computation definitions
3. Run end-to-end tests with real encrypted computations
4. Monitor performance and adjust mempool size if needed

If you run into any issues or have questions, don't hesitate to reach out on [Discord](https://discord.gg/arcium)!

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
