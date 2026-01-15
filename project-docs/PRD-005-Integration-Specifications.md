# PRD-005: Integration Specifications

**Document ID:** PRD-005  
**Version:** 1.0  
**Date:** January 10, 2026  
**Parent Document:** PRD-001  

---

## 1. Overview

This document specifies how Confidex integrates with external services and protocols, including Arcium MPC network, Helius infrastructure, wallet providers, and the Solana blockchain.

---

## 2. Arcium Integration

### 2.1 Integration Points

| Component | Integration Type | Purpose |
|-----------|-----------------|---------|
| **Arcium Testnet** | Network access | MPC computation cluster |
| **C-SPL Program** | CPI (on-chain) | Confidential token operations |
| **Arcium SDK** | Client library | Order encryption/decryption |
| **MXE Cluster** | Off-chain compute | Order matching computation |

### 2.2 Testnet Access

```yaml
Network: Arcium Testnet
Registration: https://developers.arcium.com
API Endpoint: https://testnet.arcium.dev/v1
Cluster ID: To be assigned after registration

Required Credentials:
  - API Key
  - Cluster membership certificate
  - MXE access token
```

### 2.3 SDK Integration

```typescript
// arcium-client.ts
import { ArciumClient, MXE } from '@arcium/sdk';

const arciumClient = new ArciumClient({
  network: 'testnet',
  apiKey: process.env.ARCIUM_API_KEY,
  clusterId: process.env.ARCIUM_CLUSTER_ID,
});

// Encrypt order amount
async function encryptOrderAmount(amount: bigint): Promise<Uint8Array> {
  const mxe = await arciumClient.getMXE();
  return mxe.encrypt(amount);
}

// Request MPC comparison
async function compareEncryptedPrices(
  buyPrice: Uint8Array,
  sellPrice: Uint8Array
): Promise<boolean> {
  const mxe = await arciumClient.getMXE();
  return mxe.compareGte(buyPrice, sellPrice);
}
```

### 2.4 C-SPL CPI Interface

```rust
// programs/confidex/src/cpi/cspl.rs
use anchor_lang::prelude::*;

pub fn wrap_to_confidential<'info>(
    cspl_program: AccountInfo<'info>,
    source_token: AccountInfo<'info>,
    dest_confidential: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    // CPI to C-SPL program
    let ix = cspl::instruction::wrap(amount);
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[source_token, dest_confidential, authority],
    )?;
    Ok(())
}

pub fn confidential_transfer<'info>(
    cspl_program: AccountInfo<'info>,
    source: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    encrypted_amount: [u8; 64],
    proof: Vec<u8>,
) -> Result<()> {
    // CPI with encrypted amount
    let ix = cspl::instruction::transfer(encrypted_amount, proof);
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[source, destination, authority],
    )?;
    Ok(())
}
```

### 2.5 MPC Operations Required

| Operation | Input | Output | Latency |
|-----------|-------|--------|---------|
| `encrypt` | u64 | [u8; 64] | ~200ms |
| `compare_gte` | [u8; 64] × 2 | bool | ~400ms |
| `min` | [u8; 64] × 2 | [u8; 64] | ~400ms |
| `add` | [u8; 64] × 2 | [u8; 64] | ~300ms |
| `sub` | [u8; 64] × 2 | [u8; 64] | ~300ms |
| `mul_scalar` | [u8; 64], u64 | [u8; 64] | ~350ms |

---

## 3. Helius Integration

### 3.1 Services Used

| Service | Purpose | Plan Required |
|---------|---------|---------------|
| **RPC Nodes** | Transaction submission, state reads | Free tier sufficient |
| **Enhanced RPC** | Priority fees, faster confirmations | Free tier |
| **Photon** | Compressed account indexing | Free tier |
| **Webhooks** | Real-time transaction notifications | Free tier |
| **DAS API** | Asset metadata (future) | Free tier |

### 3.2 RPC Configuration

```typescript
// helius-client.ts
import { Helius } from 'helius-sdk';

const helius = new Helius(process.env.HELIUS_API_KEY);

// Connection for transactions
export const connection = helius.connection;

// Enhanced transaction options
export async function sendTransaction(tx: Transaction) {
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  tx.recentBlockhash = blockhash;
  
  // Use Helius priority fee estimation
  const priorityFee = await helius.rpc.getPriorityFeeEstimate({
    transaction: tx,
    options: { priorityLevel: 'High' }
  });
  
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFee.priorityFeeEstimate
  }));
  
  return connection.sendTransaction(tx);
}
```

### 3.3 Webhook Configuration

```typescript
// webhook-handler.ts
interface HeliusWebhookPayload {
  type: 'TRANSACTION';
  timestamp: string;
  slot: number;
  signature: string;
  success: boolean;
  events: TransactionEvent[];
}

// Register webhook for our program
async function registerWebhook() {
  await helius.createWebhook({
    webhookURL: 'https://api.confidex.io/webhooks/helius',
    transactionTypes: ['ANY'],
    accountAddresses: [SHADOWSWAP_PROGRAM_ID],
    webhookType: 'enhanced',
  });
}

// Handle incoming webhooks
app.post('/webhooks/helius', async (req, res) => {
  const payload = req.body as HeliusWebhookPayload;
  
  if (payload.success) {
    // Parse transaction events
    for (const event of payload.events) {
      if (event.type === 'ORDER_PLACED') {
        await notifyOrderPlaced(event);
      } else if (event.type === 'ORDER_MATCHED') {
        await notifyOrderMatched(event);
      }
    }
  }
  
  res.status(200).send('OK');
});
```

### 3.4 Photon Indexing (Compressed Accounts)

```typescript
// photon-queries.ts
import { Helius } from 'helius-sdk';

// Query user's orders using Photon
async function getUserOrders(userPubkey: PublicKey) {
  const assets = await helius.rpc.getAssetsByOwner({
    ownerAddress: userPubkey.toString(),
    page: 1,
    limit: 100,
    options: {
      showFungible: false,
      showNativeBalance: false,
    }
  });
  
  return assets.items.filter(asset => 
    asset.compression?.data_hash != null &&
    asset.grouping?.some(g => g.group_value === SHADOWSWAP_PROGRAM_ID)
  );
}
```

---

## 4. Wallet Integration

### 4.1 Supported Wallets

| Wallet | Priority | Notes |
|--------|----------|-------|
| **Phantom** | P0 | Most popular Solana wallet |
| **Solflare** | P0 | Strong mobile support |
| **Backpack** | P1 | Growing user base |
| **Ledger** | P1 | Hardware security |
| **WalletConnect** | P2 | Multi-chain support |

### 4.2 Wallet Adapter Setup

```typescript
// wallet-provider.tsx
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  BackpackWalletAdapter,
  LedgerWalletAdapter,
} from '@solana/wallet-adapter-wallets';

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new BackpackWalletAdapter(),
  new LedgerWalletAdapter(),
];

export function WalletContextProvider({ children }) {
  return (
    <ConnectionProvider endpoint={HELIUS_RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

### 4.3 Message Signing for Key Derivation

```typescript
// derive-keys.ts
import { useWallet } from '@solana/wallet-adapter-react';

async function deriveEncryptionKeys(wallet: WalletContextState) {
  const message = new TextEncoder().encode(
    'Confidex Key Derivation v1\n' +
    'Sign this message to derive your encryption keys.\n' +
    'This will not cost any SOL.'
  );
  
  const signature = await wallet.signMessage!(message);
  
  // Derive ElGamal keypair from signature
  const hash = await crypto.subtle.digest('SHA-256', signature);
  const scalar = new Uint8Array(hash);
  
  return {
    secretKey: scalar,
    publicKey: scalarMult(G, scalar),
  };
}
```

---

## 5. Noir/Sunspot Integration

### 5.1 Circuit Compilation Pipeline

```bash
# Build pipeline for eligibility circuit

# 1. Compile Noir to ACIR
nargo compile --package eligibility

# 2. Generate proving/verification keys with Sunspot
sunspot setup target/eligibility.json --output keys/

# 3. Deploy verifier to Solana
solana program deploy keys/verifier.so

# 4. Export WASM prover for frontend
wasm-pack build --target web
```

### 5.2 Verifier Program Deployment

```typescript
// deploy-verifier.ts
import { deployProgram } from '@solana/web3.js';

async function deployVerifier() {
  const verifierBinary = fs.readFileSync('keys/verifier.so');
  
  const programId = await deployProgram(
    connection,
    wallet,
    verifierBinary
  );
  
  console.log(`Verifier deployed: ${programId}`);
  
  // Initialize verifier state
  await initializeVerifier(programId, {
    vkHash: computeVkHash('keys/vk.json'),
  });
  
  return programId;
}
```

### 5.3 Client-Side Proof Generation

```typescript
// proof-generator.ts
import { Noir } from '@noir-lang/noir_js';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';
import circuit from '../circuits/eligibility.json';

let noir: Noir | null = null;

async function initProver() {
  if (noir) return noir;
  
  const backend = new BarretenbergBackend(circuit);
  noir = new Noir(circuit, backend);
  
  return noir;
}

export async function generateEligibilityProof(
  address: PublicKey,
  blacklistRoot: Uint8Array,
  merkleWitness: MerkleWitness
): Promise<{ proof: Uint8Array; publicInputs: Uint8Array[] }> {
  const prover = await initProver();
  
  const inputs = {
    blacklist_root: Array.from(blacklistRoot),
    address: addressToField(address),
    sibling_path: merkleWitness.siblings.map(s => Array.from(s)),
    path_indices: merkleWitness.indices,
    leaf_low: Array.from(merkleWitness.leafLow),
    leaf_high: Array.from(merkleWitness.leafHigh),
    leaf_low_path: merkleWitness.leafLowPath.map(s => Array.from(s)),
    leaf_high_path: merkleWitness.leafHighPath.map(s => Array.from(s)),
  };
  
  const proof = await prover.generateProof(inputs);
  
  return {
    proof: proof.proof,
    publicInputs: proof.publicInputs,
  };
}
```

---

## 6. External Data Services

### 6.1 Price Oracles (Future)

| Provider | Purpose | Integration |
|----------|---------|-------------|
| **Pyth** | Real-time price feeds | Direct on-chain read |
| **Switchboard** | Custom oracle data | On-chain CPI |

### 6.2 Blacklist Data Source

```typescript
// blacklist-service.ts

interface BlacklistProvider {
  getRoot(): Promise<Uint8Array>;
  getMerkleProof(address: PublicKey): Promise<MerkleWitness>;
}

class ConfidexBlacklistProvider implements BlacklistProvider {
  private readonly endpoint = 'https://api.confidex.io/blacklist';
  
  async getRoot(): Promise<Uint8Array> {
    const res = await fetch(`${this.endpoint}/root`);
    const { root } = await res.json();
    return Uint8Array.from(Buffer.from(root, 'hex'));
  }
  
  async getMerkleProof(address: PublicKey): Promise<MerkleWitness> {
    const res = await fetch(`${this.endpoint}/proof/${address.toString()}`);
    return res.json();
  }
}
```

---

## 7. API Endpoints

### 7.1 Confidex API (Future)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/pairs` | GET | List trading pairs |
| `/v1/pairs/:id/orderbook` | GET | Aggregated order book |
| `/v1/orders` | POST | Submit order (via tx) |
| `/v1/orders/:id` | GET | Order status |
| `/v1/users/:address/orders` | GET | User's orders |
| `/v1/users/:address/balances` | GET | User's balances |
| `/v1/blacklist/proof/:address` | GET | Merkle proof |

### 7.2 WebSocket Streams (Future)

```typescript
// WebSocket message types
type WSMessage = 
  | { type: 'subscribe'; channel: 'orders' | 'trades'; pair: string }
  | { type: 'unsubscribe'; channel: string }
  | { type: 'order_update'; data: OrderUpdate }
  | { type: 'trade'; data: Trade };
```

---

## 8. Environment Configuration

### 8.1 Environment Variables

```bash
# .env.example

# Solana
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=XXX

# Helius
HELIUS_API_KEY=your-helius-api-key

# Arcium
ARCIUM_API_KEY=your-arcium-api-key
ARCIUM_CLUSTER_ID=confidex-cluster

# Programs
NEXT_PUBLIC_SHADOWSWAP_PROGRAM_ID=XXX
NEXT_PUBLIC_VERIFIER_PROGRAM_ID=XXX
NEXT_PUBLIC_CSPL_PROGRAM_ID=XXX

# Blacklist Service
BLACKLIST_API_URL=https://api.confidex.io/blacklist

# Feature Flags
NEXT_PUBLIC_ENABLE_ZK_PROOFS=true
NEXT_PUBLIC_ENABLE_AUDITOR=false
```

### 8.2 Network Configuration

```typescript
// config/networks.ts
export const networks = {
  devnet: {
    name: 'Devnet',
    rpcUrl: 'https://devnet.helius-rpc.com',
    arciumNetwork: 'testnet',
    explorerUrl: 'https://explorer.solana.com/?cluster=devnet',
    programs: {
      confidex: new PublicKey('...'),
      verifier: new PublicKey('...'),
      cspl: new PublicKey('...'),
    },
  },
  mainnet: {
    name: 'Mainnet',
    rpcUrl: 'https://mainnet.helius-rpc.com',
    arciumNetwork: 'mainnet',
    explorerUrl: 'https://explorer.solana.com',
    programs: {
      confidex: new PublicKey('...'),
      verifier: new PublicKey('...'),
      cspl: new PublicKey('...'),
    },
  },
};
```

---

## 9. Testing Integration Points

### 9.1 Mock Services for Development

```typescript
// mocks/arcium-mock.ts
export class MockArciumClient {
  async encrypt(value: bigint): Promise<Uint8Array> {
    // Simple mock: just encode the value
    const buffer = new ArrayBuffer(64);
    new DataView(buffer).setBigUint64(0, value, true);
    return new Uint8Array(buffer);
  }
  
  async compareGte(a: Uint8Array, b: Uint8Array): Promise<boolean> {
    const aVal = new DataView(a.buffer).getBigUint64(0, true);
    const bVal = new DataView(b.buffer).getBigUint64(0, true);
    return aVal >= bVal;
  }
}
```

### 9.2 Integration Test Suite

```typescript
// tests/integration.test.ts
describe('External Integrations', () => {
  describe('Helius RPC', () => {
    it('connects successfully', async () => {
      const slot = await connection.getSlot();
      expect(slot).toBeGreaterThan(0);
    });
    
    it('estimates priority fees', async () => {
      const fee = await helius.rpc.getPriorityFeeEstimate({...});
      expect(fee.priorityFeeEstimate).toBeGreaterThan(0);
    });
  });
  
  describe('Arcium MPC', () => {
    it('encrypts and decrypts values', async () => {
      const value = 1000n;
      const encrypted = await arcium.encrypt(value);
      const decrypted = await arcium.decrypt(encrypted);
      expect(decrypted).toEqual(value);
    });
  });
  
  describe('Noir Proofs', () => {
    it('generates valid eligibility proof', async () => {
      const proof = await generateEligibilityProof(...);
      const valid = await verifyProof(proof);
      expect(valid).toBe(true);
    });
  });
});
```

---

## 10. Monitoring & Observability

### 10.1 Key Metrics to Track

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| RPC latency | Helius | > 500ms |
| MPC operation time | Arcium | > 2s |
| Proof generation time | Client | > 5s |
| Transaction success rate | Helius webhooks | < 95% |
| Active connections | WebSocket server | > 1000 |

### 10.2 Logging Strategy

```typescript
// logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
  },
});

// Log integration calls
export function logIntegrationCall(
  service: 'arcium' | 'helius' | 'noir',
  operation: string,
  duration: number,
  success: boolean,
  error?: Error
) {
  logger.info({
    service,
    operation,
    duration,
    success,
    error: error?.message,
  }, `${service}.${operation}`);
}
```

---

## 11. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 10, 2026 | Zac | Initial document |
