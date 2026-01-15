# PRD-003: Cryptographic Infrastructure

**Document ID:** PRD-003  
**Version:** 1.0  
**Date:** January 10, 2026  
**Parent Document:** PRD-001 Master Overview  

---

## 1. Overview

This document specifies the cryptographic systems powering Confidex's privacy features, including Multi-Party Computation (MPC) via Arcium, Zero-Knowledge proofs via Noir, and the Confidential SPL Token standard.

### 1.1 Cryptographic Stack Summary

| Layer | Technology | Security Basis | Purpose |
|-------|------------|----------------|---------|
| **Compute** | Arcium MPC (Cerberus) | 1-of-n honest majority | Encrypted order matching |
| **Proofs** | Noir + Groth16 | zkSNARK soundness | Eligibility verification |
| **Tokens** | C-SPL | ElGamal + MPC | Persistent encrypted balances |
| **Hashing** | Poseidon | Algebraic hash | ZK-friendly address hashing |

---

## 2. Arcium Multi-Party Computation

### 2.1 Architecture Overview

Arcium provides a decentralized network of MPC nodes (Arx nodes) that execute computations on encrypted data without revealing the underlying values.

```
┌─────────────────────────────────────────────────────────────────┐
│                        ARCIUM NETWORK                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    │
│   │  Arx    │    │  Arx    │    │  Arx    │    │  Arx    │    │
│   │ Node 1  │    │ Node 2  │    │ Node 3  │    │ Node N  │    │
│   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘    │
│        │              │              │              │          │
│        └──────────────┴──────────────┴──────────────┘          │
│                           │                                     │
│                    ┌──────▼──────┐                             │
│                    │    MXE      │                             │
│                    │ (Execution  │                             │
│                    │ Environment)│                             │
│                    └─────────────┘                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │     SOLANA      │
                    │  (Orchestrator) │
                    └─────────────────┘
```

### 2.2 MPC Protocol Selection

| Protocol | Security Model | Performance | Use Case |
|----------|---------------|-------------|----------|
| **Cerberus** | Dishonest majority (1-of-n honest) | Moderate | High-security DeFi ✅ |
| **Manticore** | Semi-honest with access control | Fast | AI/ML workloads |

**Confidex uses Cerberus** for maximum security guarantees.

#### Cerberus Security Properties

- **Privacy:** Guaranteed if at least 1 node is honest
- **Correctness:** Computation results are verifiable
- **Identifiable Abort:** Malicious nodes can be identified and penalized
- **No Trusted Setup:** No ceremony or trusted parties required

### 2.3 Encrypted Data Types

```rust
/// Arcium encrypted unsigned 64-bit integer
pub struct EncryptedU64 {
    /// Secret shares distributed across MPC nodes
    pub shares: Vec<[u8; 32]>,
    /// Commitment to the encrypted value
    pub commitment: [u8; 32],
    /// MXE identifier
    pub mxe_id: [u8; 16],
}

/// Arcium encrypted boolean
pub struct EncryptedBool {
    pub shares: Vec<[u8; 32]>,
    pub commitment: [u8; 32],
    pub mxe_id: [u8; 16],
}
```

### 2.4 Required MPC Operations

#### 2.4.1 Price Comparison

**Purpose:** Determine if buy price meets or exceeds sell price.

```
Input:  enc(buy_price), enc(sell_price)
Output: bool (buy_price >= sell_price)
```

**MPC Protocol Flow:**
1. Both encrypted prices loaded into MXE
2. Nodes compute comparison on secret shares
3. Result reconstructed (only boolean revealed)
4. Boolean returned to Solana program

#### 2.4.2 Minimum Calculation

**Purpose:** Calculate fill amount as minimum of two order sizes.

```
Input:  enc(amount_a), enc(amount_b)
Output: enc(min(amount_a, amount_b))
```

**MPC Protocol Flow:**
1. Both amounts loaded into MXE
2. Comparison computed
3. Conditional selection based on comparison
4. New encrypted result returned

#### 2.4.3 Encrypted Addition/Subtraction

**Purpose:** Update filled amounts, calculate remaining.

```
Input:  enc(a), enc(b)
Output: enc(a + b) or enc(a - b)
```

#### 2.4.4 Fee Calculation

**Purpose:** Calculate trading fee from encrypted amount.

```
Input:  enc(amount), public fee_bps
Output: enc(amount * fee_bps / 10000)
```

### 2.5 MXE Configuration

| Parameter | Value | Notes |
|-----------|-------|-------|
| Cluster Size | 3-5 nodes | Minimum for Cerberus security |
| Computation Timeout | 10 seconds | Per operation |
| Retry Policy | 3 attempts | Exponential backoff |
| Network | Arcium Testnet | For hackathon |

### 2.6 Expected Latency

| Operation | Expected Latency |
|-----------|------------------|
| Price comparison | ~500ms |
| Amount calculation | ~500ms |
| Full order match | 1-2 seconds |

---

## 3. Zero-Knowledge Proofs (Noir)

### 3.1 Proof System Overview

| Component | Specification |
|-----------|--------------|
| Language | Noir 1.0.0-beta.13 |
| Proof System | Groth16 (pairing-based zkSNARK) |
| Compiler | Sunspot (Noir → Solana verifier) |
| Proof Size | ~388 bytes |
| Verification Cost | ~200,000 compute units |

### 3.2 Proof Pipeline

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│  Noir Circuit  │     │    Sunspot     │     │    Solana      │
│   (main.nr)    │────▶│    Compile     │────▶│   Verifier     │
│                │     │                │     │    (.so)       │
└────────────────┘     └────────────────┘     └────────────────┘
        │
        │ nargo compile
        ▼
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│  ACIR Bytecode │     │  Proving Key   │     │   Groth16      │
│    (.json)     │────▶│     (.pk)      │────▶│    Proof       │
│                │     │                │     │   (.proof)     │
└────────────────┘     └────────────────┘     └────────────────┘
                              │
                              │ sunspot prove
                              ▼
                       ┌────────────────┐
                       │  Proof Bytes   │
                       │  (~388 bytes)  │
                       └────────────────┘
```

### 3.3 Eligibility Circuit Specification

#### 3.3.1 Purpose

Prove that a user's address is NOT on the exchange's blacklist, without revealing the address.

#### 3.3.2 Circuit Definition

```noir
// circuits/eligibility/src/main.nr

use std::hash::poseidon;

global TREE_DEPTH: u32 = 20;

fn main(
    // Public inputs
    blacklist_root: pub Field,
    
    // Private inputs
    address: Field,
    merkle_path: [Field; TREE_DEPTH],
    path_indices: [bool; TREE_DEPTH]
) {
    // Hash the address with Poseidon (ZK-friendly hash)
    let address_hash = poseidon::hash_1([address]);
    
    // Verify non-membership in Sparse Merkle Tree
    let is_not_member = verify_smt_non_membership(
        blacklist_root,
        address_hash,
        merkle_path,
        path_indices
    );
    
    // Assert the address is NOT in the blacklist
    assert(is_not_member);
}

fn verify_smt_non_membership(
    root: Field,
    leaf_hash: Field,
    path: [Field; TREE_DEPTH],
    indices: [bool; TREE_DEPTH]
) -> bool {
    // Compute expected root if leaf is NOT present
    // (leaf position should contain default/empty value)
    let mut current = 0; // Empty leaf value
    
    for i in 0..TREE_DEPTH {
        let sibling = path[i];
        if indices[i] {
            current = poseidon::hash_2([sibling, current]);
        } else {
            current = poseidon::hash_2([current, sibling]);
        }
    }
    
    // Root should match if address is not in tree
    current == root
}
```

#### 3.3.3 Input Specification

| Input | Type | Visibility | Size | Description |
|-------|------|------------|------|-------------|
| `blacklist_root` | Field | Public | 32 bytes | SMT root stored on-chain |
| `address` | Field | Private | 32 bytes | User's Solana address |
| `merkle_path` | [Field; 20] | Private | 640 bytes | SMT proof path |
| `path_indices` | [bool; 20] | Private | 20 bits | Path directions |

#### 3.3.4 Output

- **Valid proof:** Address is NOT on blacklist
- **Invalid/no proof:** Cannot prove non-membership (possibly blacklisted)

### 3.4 Proof Generation (Server-Side via Sunspot)

```typescript
// Server-side proof generation via Sunspot
// NOTE: Barretenberg cannot be used for Solana verification.
// Groth16 proofs via Sunspot are required (~388 bytes, ~200K compute units).

// Frontend requests proof from backend
async function requestEligibilityProof(
  userAddress: PublicKey,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>
): Promise<Uint8Array> {
  // 1. Sign a message to prove wallet ownership
  const message = new TextEncoder().encode(
    `Confidex Eligibility Proof Request\nAddress: ${userAddress.toString()}\nTimestamp: ${Date.now()}`
  );
  const signature = await signMessage(message);

  // 2. Request proof from backend (proof server)
  const response = await fetch('/api/prove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: userAddress.toString(),
      signature: Array.from(signature),
      message: Array.from(message),
    }),
  });

  const { proof } = await response.json();
  return new Uint8Array(proof); // ~388 bytes Groth16 proof
}

// Backend proof server (Node.js/Express)
// POST /api/prove
async function handleProveRequest(req, res) {
  const { address, signature, message } = req.body;

  // 1. Verify signature matches address
  const isValid = nacl.sign.detached.verify(
    new Uint8Array(message),
    new Uint8Array(signature),
    new PublicKey(address).toBytes()
  );
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

  // 2. Fetch current blacklist root from chain
  const exchangeState = await program.account.exchangeState.fetch(exchangePda);
  const blacklistRoot = exchangeState.blacklistRoot;

  // 3. Get merkle proof from blacklist indexer
  const { path, indices } = await fetchMerkleProof(address);

  // 4. Write Prover.toml
  const proverToml = `
blacklist_root = "${Buffer.from(blacklistRoot).toString('hex')}"
address = "${address}"
merkle_path = [${path.map(p => `"${p}"`).join(', ')}]
path_indices = [${indices.join(', ')}]
`;
  fs.writeFileSync('circuits/eligibility/Prover.toml', proverToml);

  // 5. Generate proof via Sunspot CLI
  execSync('cd circuits/eligibility && sunspot prove circuit.json Prover.toml circuit.ccs key.pk');

  // 6. Read and return proof bytes
  const proof = fs.readFileSync('circuits/eligibility/proof.proof');
  return res.json({ proof: Array.from(proof) });
}
```

### 3.5 On-Chain Verification

```rust
// Solana program verification
pub fn verify_eligibility_proof(
    verifier_program: &AccountInfo,
    proof: &[u8; 388],
    blacklist_root: &[u8; 32],
) -> Result<bool> {
    // Construct instruction data
    let mut instruction_data = Vec::with_capacity(420);
    instruction_data.extend_from_slice(proof);
    instruction_data.extend_from_slice(blacklist_root);
    
    // CPI to Sunspot verifier
    let ix = Instruction {
        program_id: *verifier_program.key,
        accounts: vec![],
        data: instruction_data,
    };
    
    invoke(&ix, &[])?;
    
    // If we reach here, proof is valid
    Ok(true)
}
```

---

## 4. Confidential SPL Token (C-SPL)

### 4.1 Overview

C-SPL extends Token-2022's Confidential Transfer Extension with Arcium MPC integration, enabling program-controlled confidential accounts.

### 4.2 Comparison with Token-2022

| Feature | Token-2022 CT | C-SPL |
|---------|---------------|-------|
| Account control | EOA only | Programs/PDAs ✅ |
| Recipient setup | Pre-creation required | Sender can create ✅ |
| DeFi compatibility | Limited | Full ✅ |
| Auditor support | Basic | Programmable ✅ |
| Token wrapping | Manual | Canonical ✅ |

### 4.3 Encryption Scheme

#### 4.3.1 Balance Encryption (ElGamal)

C-SPL uses Twisted ElGamal encryption for homomorphic balance operations:

```
Public Key: pk = g^sk (where sk is private key)

Encrypt(m, pk, r):
  C1 = g^r
  C2 = pk^r * g^m
  Return (C1, C2)

Decrypt(C1, C2, sk):
  m = dlog(C2 / C1^sk)
  Return m

Add(E1, E2):
  // Homomorphic addition
  Return (E1.C1 * E2.C1, E1.C2 * E2.C2)
```

#### 4.3.2 Transfer Proofs

Each confidential transfer requires:

1. **Range Proof:** Amount is non-negative and within bounds
2. **Balance Proof:** Sender has sufficient balance
3. **Equality Proof:** Sender's debit equals recipient's credit

### 4.4 Account Structure

```rust
/// Confidential Token Account (simplified)
pub struct ConfidentialTokenAccount {
    /// Standard token account fields
    pub mint: Pubkey,
    pub owner: Pubkey,
    
    /// ElGamal public key for encryption
    pub elgamal_pubkey: ElGamalPubkey,
    
    /// Encrypted available balance
    pub available_balance: ElGamalCiphertext,
    
    /// Encrypted pending balance (incoming transfers)
    pub pending_balance: ElGamalCiphertext,
    
    /// Counter for pending balance (anti-front-running)
    pub pending_balance_credit_counter: u64,
    
    /// Optional auditor public key
    pub auditor_elgamal_pubkey: Option<ElGamalPubkey>,
    
    /// Decryptable available balance (for auditor)
    pub decryptable_available_balance: Option<AeCiphertext>,
}

/// ElGamal ciphertext (compressed)
pub struct ElGamalCiphertext {
    pub c1: CompressedRistretto, // 32 bytes
    pub c2: CompressedRistretto, // 32 bytes
}
```

### 4.5 C-SPL Operations

#### 4.5.1 Wrap (Public → Confidential)

```rust
pub fn wrap_to_confidential(
    amount: u64,
    source: &TokenAccount,
    destination: &ConfidentialTokenAccount,
) -> Result<()> {
    // 1. Transfer public tokens to wrapper
    token::transfer(source, wrapper_vault, amount)?;
    
    // 2. Encrypt amount with destination's public key
    let encrypted_amount = elgamal_encrypt(
        amount,
        destination.elgamal_pubkey
    );
    
    // 3. Add to pending balance
    destination.pending_balance = elgamal_add(
        destination.pending_balance,
        encrypted_amount
    );
    
    // 4. Increment counter
    destination.pending_balance_credit_counter += 1;
    
    Ok(())
}
```

#### 4.5.2 Unwrap (Confidential → Public)

```rust
pub fn unwrap_from_confidential(
    amount: u64,
    proof: &WithdrawProof,
    source: &ConfidentialTokenAccount,
    destination: &TokenAccount,
) -> Result<()> {
    // 1. Verify proof that source has sufficient balance
    verify_withdraw_proof(proof, source, amount)?;
    
    // 2. Subtract from available balance (encrypted)
    let encrypted_amount = elgamal_encrypt(
        amount,
        source.elgamal_pubkey
    );
    source.available_balance = elgamal_sub(
        source.available_balance,
        encrypted_amount
    );
    
    // 3. Transfer public tokens from wrapper
    token::transfer(wrapper_vault, destination, amount)?;
    
    Ok(())
}
```

#### 4.5.3 Apply Pending Balance

```rust
pub fn apply_pending_balance(
    account: &mut ConfidentialTokenAccount,
    expected_counter: u64,
) -> Result<()> {
    // Verify counter matches (prevents front-running)
    require!(
        account.pending_balance_credit_counter == expected_counter,
        "Counter mismatch"
    );
    
    // Move pending to available
    account.available_balance = elgamal_add(
        account.available_balance,
        account.pending_balance
    );
    
    // Reset pending
    account.pending_balance = elgamal_encrypt(0, account.elgamal_pubkey);
    
    Ok(())
}
```

---

## 5. Security Analysis

### 5.1 Threat Model

| Threat | Attack Vector | Mitigation |
|--------|--------------|------------|
| **Order front-running** | Validators see pending txs | Encrypted amounts via MPC |
| **Balance tracking** | On-chain analysis | C-SPL encrypted balances |
| **Pattern analysis** | Timing correlation | Batched settlements (future) |
| **Sybil attacks** | Multiple wallets | ZK eligibility proofs |
| **MPC collusion** | All nodes collude | Cerberus 1-of-n security |
| **ZK proof forgery** | Invalid proofs | Groth16 soundness |
| **Key compromise** | Private key theft | User responsibility |

### 5.2 Trust Assumptions

| Assumption | Basis | Consequence if Violated |
|------------|-------|------------------------|
| At least 1 Arcium node honest | Node diversity | Privacy lost if ALL collude |
| Groth16 is sound | Mathematical proof | Could forge eligibility |
| ElGamal secure | Discrete log hardness | Balances revealed |
| Poseidon collision-resistant | Algebraic design | Blacklist bypass |
| Solana executes correctly | Consensus | General chain failure |

### 5.3 Privacy Guarantees Matrix

| Data | Who Can See | Notes |
|------|-------------|-------|
| Order exists | Public | Event emitted |
| Order amount | Owner only | Encrypted via MPC |
| Order price | Owner only | Encrypted via MPC |
| Balance | Owner + optional auditor | ElGamal encrypted |
| Trade occurred | Public | Event emitted |
| Trade amount | Parties + optional auditor | Encrypted |
| Wallet identity | Public | Address visible |
| Eligibility status | Verifiable but private | ZK proof |

### 5.4 Known Limitations

1. **Timing correlation:** Order placement times are public
2. **Metadata leakage:** Number of orders, trading pairs visible
3. **Partial information:** Order book depth visible (not amounts)
4. **Key management:** User must secure ElGamal private key

---

## 6. Implementation Guide

### 6.1 Development Environment Setup

```bash
# Install Noir
noirup -v 1.0.0-beta.13

# Install Sunspot
git clone https://github.com/reilabs/sunspot.git ~/sunspot
cd ~/sunspot/go && go build -o sunspot .
export PATH="$HOME/sunspot/go:$PATH"

# Verify installations
nargo --version
sunspot --version
```

### 6.2 Circuit Development Workflow

```bash
# 1. Create new circuit
mkdir -p circuits/eligibility
cd circuits/eligibility
nargo init

# 2. Write circuit (src/main.nr)
# ... edit main.nr ...

# 3. Write test inputs (Prover.toml)
# ... edit Prover.toml ...

# 4. Test circuit
nargo test

# 5. Compile to ACIR
nargo compile

# 6. Generate Solana verifier
sunspot compile target/eligibility.json
sunspot setup eligibility.ccs
sunspot deploy eligibility.vk --output verifier.so

# 7. Deploy verifier to Solana
solana program deploy verifier.so
```

### 6.3 Proof Generation in Frontend

```typescript
// Initialize once
const circuit = await import('./circuits/eligibility.json');
const backend = new BarretenbergBackend(circuit);
const noir = new Noir(circuit, backend);
await noir.init();

// Generate proof for each order
async function proveEligibility(wallet: PublicKey): Promise<Uint8Array> {
  // Fetch current blacklist root from exchange
  const exchangeState = await program.account.exchangeState.fetch(exchangePda);
  const blacklistRoot = exchangeState.blacklistRoot;
  
  // Fetch merkle proof from indexer
  const { path, indices } = await fetchMerkleProof(wallet);
  
  // Generate proof (2-3 seconds)
  const { proof } = await noir.generateProof({
    blacklist_root: blacklistRoot,
    address: wallet.toBytes(),
    merkle_path: path,
    path_indices: indices,
  });
  
  return proof;
}
```

### 6.4 Arcium Integration

```typescript
// Initialize Arcium client
import { ArciumClient } from '@arcium/sdk';

const arcium = new ArciumClient({
  cluster: 'testnet',
  mxeId: SHADOWSWAP_MXE_ID,
});

// Encrypt order parameters
async function encryptOrder(amount: bigint, price: bigint) {
  const encryptedAmount = await arcium.encrypt(amount);
  const encryptedPrice = await arcium.encrypt(price);
  
  return { encryptedAmount, encryptedPrice };
}

// Compare prices (for off-chain simulation)
async function comparePrices(
  buyPrice: EncryptedU64,
  sellPrice: EncryptedU64
): Promise<boolean> {
  return await arcium.compare(buyPrice, sellPrice, 'gte');
}
```

---

## 7. Performance Benchmarks

### 7.1 Expected Performance

| Operation | Time | Notes |
|-----------|------|-------|
| ZK proof generation (client) | 2-3 seconds | Browser WASM |
| ZK proof verification (on-chain) | ~200K CU | ~0.001 SOL |
| MPC encryption | ~100ms | Per value |
| MPC comparison | ~500ms | Network latency dominant |
| MPC arithmetic | ~500ms | Per operation |
| Full order placement | ~3 seconds | Proof + encryption + tx |
| Full order match | ~2 seconds | MPC + settlement |

### 7.2 Optimization Strategies

1. **Pre-compute proofs:** Generate eligibility proof before order entry
2. **Batch MPC operations:** Combine multiple operations per request
3. **Cache encrypted values:** Reuse encrypted amounts when possible
4. **Parallel verification:** Verify proof while encrypting order

---

## 8. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 10, 2026 | Zac | Initial document |
