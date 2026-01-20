# Tracking Callbacks

Unlike regular transactions, confidential computations involve additional steps after your Solana transaction completes:

1. **Your transaction completes** - Encrypted data is submitted and queued in the cluster's mempool
2. **Computation waits in queue** - MPC nodes process computations from the mempool in order
3. **MPC execution** - When your computation's turn comes, MPC nodes execute it offchain
4. **Callback invocation** - Results are returned via your callback instruction

This means you can't simply await a transaction completion like normal Solana programs. Instead, you need to wait for the entire computation lifecycle to finish. The Arcium client library provides utilities to handle this:

## Await computation completion with `awaitComputationFinalization`

```typescript
// Generate a random 8-byte computation offset
const computationOffset = new anchor.BN(randomBytes(8), "hex");

// `program` is the anchor program client of the MXE we're invoking
// the instruction `ourIx` on (which then invokes a computation under the hood by CPIing into the Arcium program).
// `queueSig` is the signature of said transaction.
const queueSig = await program.methods
  .ourIx(
    // Computation offset that you provide when invoking the instruction
    computationOffset
    /* other inputs */
  )
  .accounts(/* some accounts */)
  .rpc();

// Since this is a Arcium computation, we need to wait for it to be finalized
// a little bit differently
const finalizeSig = await awaitComputationFinalization(
  // Anchor provider
  provider as anchor.AnchorProvider,
  // Computation offset that you provide when invoking the instruction
  computationOffset,
  // Program ID of the MXE
  program.programId,
  // Solana commitment level, "confirmed" by default
  "confirmed"
);

console.log("Computation was finalized with sig: ", finalizeSig);
```

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
