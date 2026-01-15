# PRD-002: Smart Contract Architecture

**Document ID:** PRD-002  
**Version:** 1.0  
**Date:** January 10, 2026  
**Parent Document:** PRD-001 Master Overview  

---

## 1. Overview

This document specifies the smart contract architecture for Confidex, detailing the on-chain programs, account structures, instructions, and cross-program invocations (CPIs) required for confidential trading.

### 1.1 Program Components

| Program | Type | Description |
|---------|------|-------------|
| `confidex_dex` | Custom (Anchor) | Core DEX logic |
| `eligibility_verifier` | Custom (Sunspot) | ZK proof verification |
| `arcium_adapter` | CPI Target | MPC operations |
| `c_spl_program` | CPI Target | Confidential tokens |

### 1.2 Program Interaction Diagram

```
                    ┌─────────────────────┐
                    │   confidex_dex    │
                    │   (Main Program)    │
                    └──────────┬──────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   eligibility   │  │  arcium_adapter │  │  c_spl_program  │
│    _verifier    │  │                 │  │                 │
│  (ZK Proofs)    │  │    (MPC Ops)    │  │ (Conf. Tokens)  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 2. Account Structures

### 2.1 Exchange State (Global Config)

**PDA Seeds:** `["exchange"]`

```rust
#[account]
pub struct ExchangeState {
    /// Admin authority for exchange operations
    pub authority: Pubkey,
    
    /// Account receiving trading fees
    pub fee_recipient: Pubkey,
    
    /// Fee for makers in basis points (e.g., 10 = 0.1%)
    pub maker_fee_bps: u16,
    
    /// Fee for takers in basis points
    pub taker_fee_bps: u16,
    
    /// Emergency pause flag
    pub paused: bool,
    
    /// Merkle root of blacklisted addresses
    pub blacklist_root: [u8; 32],
    
    /// Arcium MXE cluster for MPC operations
    pub arcium_cluster: Pubkey,
    
    /// Total number of pairs created
    pub pair_count: u64,
    
    /// Total number of orders ever created
    pub order_count: u64,
    
    /// PDA bump seed
    pub bump: u8,
}
```

**Size:** 8 (discriminator) + 32 + 32 + 2 + 2 + 1 + 32 + 32 + 8 + 8 + 1 = **158 bytes**

---

### 2.2 Trading Pair

**PDA Seeds:** `["pair", base_mint, quote_mint]`

```rust
#[account]
pub struct TradingPair {
    /// Base token mint (e.g., SOL wrapped)
    pub base_mint: Pubkey,
    
    /// Quote token mint (e.g., USDC)
    pub quote_mint: Pubkey,
    
    /// Confidential base token mint (C-SPL)
    pub c_base_mint: Pubkey,
    
    /// Confidential quote token mint (C-SPL)
    pub c_quote_mint: Pubkey,
    
    /// Pool's confidential base token account
    pub c_base_vault: Pubkey,
    
    /// Pool's confidential quote token account
    pub c_quote_vault: Pubkey,
    
    /// Minimum order size in base units
    pub min_order_size: u64,
    
    /// Price tick increment (price precision)
    pub tick_size: u64,
    
    /// Trading enabled flag
    pub active: bool,
    
    /// Number of open orders for this pair
    pub open_order_count: u64,
    
    /// Pair index
    pub index: u64,
    
    /// PDA bump seed
    pub bump: u8,
}
```

**Size:** 8 + (32 × 6) + 8 + 8 + 1 + 8 + 8 + 1 = **234 bytes**

---

### 2.3 Confidential Order

**PDA Seeds:** `["order", maker, order_id]`

```rust
#[account]
pub struct ConfidentialOrder {
    /// Order creator
    pub maker: Pubkey,
    
    /// Trading pair account
    pub pair: Pubkey,
    
    /// Buy or Sell
    pub side: Side,
    
    /// Market or Limit
    pub order_type: OrderType,
    
    /// MPC-encrypted order size (Arcium ciphertext)
    pub encrypted_amount: EncryptedU64,
    
    /// MPC-encrypted limit price (Arcium ciphertext)
    pub encrypted_price: EncryptedU64,
    
    /// MPC-encrypted filled amount
    pub encrypted_filled: EncryptedU64,
    
    /// Order status
    pub status: OrderStatus,
    
    /// Unix timestamp of creation
    pub created_at: i64,
    
    /// Order ID (unique per maker)
    pub order_id: u64,
    
    /// Groth16 eligibility proof (optional after first verification)
    pub eligibility_proof_verified: bool,
    
    /// PDA bump seed
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Buy,
    Sell,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OrderType {
    Market,
    Limit,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
}

/// Arcium encrypted u64 (placeholder - actual size from Arcium SDK)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct EncryptedU64 {
    pub ciphertext: [u8; 64],  // Actual size TBD from Arcium
}
```

**Size:** 8 + 32 + 32 + 1 + 1 + 64 + 64 + 64 + 1 + 8 + 8 + 1 + 1 = **285 bytes**

---

### 2.4 User Account (Optional - for tracking)

**PDA Seeds:** `["user", wallet]`

```rust
#[account]
pub struct UserAccount {
    /// User's wallet
    pub wallet: Pubkey,
    
    /// Total orders placed
    pub total_orders: u64,
    
    /// Total trades executed
    pub total_trades: u64,
    
    /// Eligibility proof verified (cached)
    pub eligibility_verified: bool,
    
    /// Last eligibility verification timestamp
    pub last_verification: i64,
    
    /// PDA bump seed
    pub bump: u8,
}
```

**Size:** 8 + 32 + 8 + 8 + 1 + 8 + 1 = **66 bytes**

---

## 3. Program Instructions

### 3.1 Admin Instructions

#### `initialize`

Initializes the exchange state account.

```rust
pub fn initialize(
    ctx: Context<Initialize>,
    maker_fee_bps: u16,
    taker_fee_bps: u16,
    arcium_cluster: Pubkey,
) -> Result<()>
```

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer | Admin initializing exchange |
| `exchange_state` | Init | Exchange state PDA |
| `fee_recipient` | AccountInfo | Fee collection account |
| `system_program` | Program | System program |

---

#### `create_pair`

Registers a new trading pair.

```rust
pub fn create_pair(
    ctx: Context<CreatePair>,
    min_order_size: u64,
    tick_size: u64,
) -> Result<()>
```

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer | Exchange admin |
| `exchange_state` | Mut | Exchange state |
| `trading_pair` | Init | New pair PDA |
| `base_mint` | AccountInfo | Base token mint |
| `quote_mint` | AccountInfo | Quote token mint |
| `c_base_mint` | AccountInfo | Confidential base mint |
| `c_quote_mint` | AccountInfo | Confidential quote mint |
| `c_base_vault` | Init | Pool's confidential base account |
| `c_quote_vault` | Init | Pool's confidential quote account |
| `system_program` | Program | System program |
| `c_spl_program` | Program | C-SPL program |

---

#### `update_fees`

Updates trading fee rates.

```rust
pub fn update_fees(
    ctx: Context<UpdateFees>,
    new_maker_fee_bps: u16,
    new_taker_fee_bps: u16,
) -> Result<()>
```

---

#### `update_blacklist`

Updates the blacklist merkle root.

```rust
pub fn update_blacklist(
    ctx: Context<UpdateBlacklist>,
    new_root: [u8; 32],
) -> Result<()>
```

---

#### `pause` / `unpause`

Emergency trading controls.

```rust
pub fn pause(ctx: Context<Pause>) -> Result<()>
pub fn unpause(ctx: Context<Unpause>) -> Result<()>
```

---

### 3.2 User Instructions

#### `wrap_tokens`

Converts SPL tokens to C-SPL (confidential).

```rust
pub fn wrap_tokens(
    ctx: Context<WrapTokens>,
    amount: u64,
) -> Result<()>
```

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| `user` | Signer | User wrapping tokens |
| `user_token_account` | Mut | User's SPL token account |
| `user_c_token_account` | Mut | User's C-SPL account |
| `mint` | AccountInfo | Token mint |
| `c_mint` | AccountInfo | Confidential mint |
| `token_program` | Program | Token program |
| `c_spl_program` | Program | C-SPL program |

**Logic:**
1. Transfer SPL tokens to wrapper
2. Mint equivalent C-SPL to user
3. Encrypt balance via Arcium

---

#### `unwrap_tokens`

Converts C-SPL back to public SPL tokens.

```rust
pub fn unwrap_tokens(
    ctx: Context<UnwrapTokens>,
    amount: u64,  // User provides decrypted amount
    proof: Vec<u8>,  // Proof that amount is valid
) -> Result<()>
```

---

#### `place_order`

Submits an encrypted order with eligibility proof.

```rust
pub fn place_order(
    ctx: Context<PlaceOrder>,
    side: Side,
    order_type: OrderType,
    encrypted_amount: EncryptedU64,
    encrypted_price: EncryptedU64,
    eligibility_proof: [u8; 388],  // Groth16 proof
) -> Result<()>
```

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| `maker` | Signer | Order creator |
| `exchange_state` | AccountInfo | Exchange config |
| `trading_pair` | Mut | Trading pair |
| `order` | Init | New order PDA |
| `maker_c_token_account` | Mut | Maker's confidential token account |
| `pair_vault` | Mut | Pair's confidential vault |
| `eligibility_verifier` | Program | ZK verifier program |
| `arcium_adapter` | Program | MPC adapter |
| `c_spl_program` | Program | C-SPL program |
| `system_program` | Program | System program |

**Logic:**
1. Verify exchange not paused
2. Verify eligibility proof against blacklist_root
3. Lock confidential tokens in pair vault
4. Store encrypted order parameters
5. Emit order placed event

---

#### `cancel_order`

Cancels an open order and returns locked funds.

```rust
pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()>
```

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| `maker` | Signer | Order owner |
| `order` | Mut | Order to cancel |
| `trading_pair` | Mut | Trading pair |
| `maker_c_token_account` | Mut | Return destination |
| `pair_vault` | Mut | Locked funds source |
| `arcium_adapter` | Program | MPC adapter |
| `c_spl_program` | Program | C-SPL program |

**Logic:**
1. Verify maker owns order
2. Verify order is Open or PartiallyFilled
3. Calculate remaining locked amount (via MPC)
4. Transfer remaining back to maker
5. Set status to Cancelled

---

### 3.3 Matching Instructions

#### `match_orders`

Attempts to match two orders via MPC price comparison.

```rust
pub fn match_orders(ctx: Context<MatchOrders>) -> Result<()>
```

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| `crank` | Signer | Matching authority (can be permissionless) |
| `exchange_state` | AccountInfo | Exchange config |
| `trading_pair` | Mut | Trading pair |
| `buy_order` | Mut | Buy order |
| `sell_order` | Mut | Sell order |
| `buyer_c_base_account` | Mut | Buyer receives base |
| `seller_c_quote_account` | Mut | Seller receives quote |
| `pair_base_vault` | Mut | Pair's base vault |
| `pair_quote_vault` | Mut | Pair's quote vault |
| `fee_c_account` | Mut | Fee recipient |
| `arcium_adapter` | Program | MPC adapter |
| `c_spl_program` | Program | C-SPL program |

**Logic:**
1. Verify both orders are Open or PartiallyFilled
2. Verify orders are opposite sides
3. **MPC Call:** Compare encrypted prices
   - `buy_price >= sell_price` → match possible
4. **MPC Call:** Calculate fill amount
   - `fill = min(buy_remaining, sell_remaining)`
5. **MPC Call:** Calculate execution price
   - Typically: `(buy_price + sell_price) / 2` or price-time priority
6. Execute confidential transfers
7. Update order statuses and filled amounts
8. Emit trade event

---

## 4. Cross-Program Invocation (CPI) Details

### 4.1 CPI to Eligibility Verifier

```rust
// Verify ZK proof of non-blacklist membership
pub fn verify_eligibility(
    verifier_program: AccountInfo,
    proof: &[u8; 388],
    public_inputs: &[u8],  // blacklist_root
) -> Result<bool>
```

**Instruction Data Format:**
```
| proof_bytes (388) | public_witness_bytes (32) |
```

---

### 4.2 CPI to Arcium Adapter

```rust
// Encrypt a u64 value
pub fn encrypt_value(
    arcium_program: AccountInfo,
    cluster: Pubkey,
    value: u64,
) -> Result<EncryptedU64>

// Compare two encrypted values
pub fn compare_encrypted(
    arcium_program: AccountInfo,
    cluster: Pubkey,
    a: &EncryptedU64,
    b: &EncryptedU64,
) -> Result<bool>  // Returns a >= b

// Add two encrypted values
pub fn add_encrypted(
    arcium_program: AccountInfo,
    cluster: Pubkey,
    a: &EncryptedU64,
    b: &EncryptedU64,
) -> Result<EncryptedU64>

// Subtract encrypted values
pub fn sub_encrypted(
    arcium_program: AccountInfo,
    cluster: Pubkey,
    a: &EncryptedU64,
    b: &EncryptedU64,
) -> Result<EncryptedU64>

// Multiply encrypted by public scalar
pub fn mul_encrypted_scalar(
    arcium_program: AccountInfo,
    cluster: Pubkey,
    encrypted: &EncryptedU64,
    scalar: u64,
) -> Result<EncryptedU64>
```

---

### 4.3 CPI to C-SPL Program

```rust
// Confidential transfer between accounts
pub fn confidential_transfer(
    c_spl_program: AccountInfo,
    source: AccountInfo,
    destination: AccountInfo,
    authority: AccountInfo,
    amount: &EncryptedU64,
    proof: &[u8],  // Range proof
) -> Result<()>

// Deposit public tokens to confidential account
pub fn deposit_confidential(
    c_spl_program: AccountInfo,
    public_source: AccountInfo,
    confidential_dest: AccountInfo,
    authority: AccountInfo,
    amount: u64,
) -> Result<()>

// Withdraw from confidential to public
pub fn withdraw_confidential(
    c_spl_program: AccountInfo,
    confidential_source: AccountInfo,
    public_dest: AccountInfo,
    authority: AccountInfo,
    amount: u64,
    proof: &[u8],  // Proof of sufficient balance
) -> Result<()>
```

---

## 5. Events

### 5.1 Event Definitions

```rust
#[event]
pub struct OrderPlaced {
    pub maker: Pubkey,
    pub pair: Pubkey,
    pub order: Pubkey,
    pub side: Side,
    pub order_type: OrderType,
    pub timestamp: i64,
    // Note: Amount and price NOT emitted (confidential)
}

#[event]
pub struct OrderCancelled {
    pub maker: Pubkey,
    pub order: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TradeExecuted {
    pub pair: Pubkey,
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub timestamp: i64,
    // Note: Amount and price NOT emitted (confidential)
}

#[event]
pub struct PairCreated {
    pub pair: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub index: u64,
}
```

---

## 6. Error Codes

```rust
#[error_code]
pub enum ConfidexError {
    #[msg("Exchange is paused")]
    ExchangePaused,
    
    #[msg("Invalid eligibility proof")]
    InvalidEligibilityProof,
    
    #[msg("Order not found or unauthorized")]
    OrderUnauthorized,
    
    #[msg("Order already filled or cancelled")]
    OrderNotActive,
    
    #[msg("Orders are not matchable")]
    OrdersNotMatchable,
    
    #[msg("Insufficient confidential balance")]
    InsufficientBalance,
    
    #[msg("Invalid trading pair")]
    InvalidPair,
    
    #[msg("Order amount below minimum")]
    BelowMinimumOrder,
    
    #[msg("MPC operation failed")]
    MpcOperationFailed,
    
    #[msg("Confidential transfer failed")]
    ConfidentialTransferFailed,
    
    #[msg("Invalid proof data")]
    InvalidProofData,
    
    #[msg("Pair not active")]
    PairNotActive,
}
```

---

## 7. Dual Settlement Architecture

Confidex supports two settlement methods: Arcium C-SPL (native confidential tokens) and ShadowWire (Bulletproof-based private transfers). This provides production reliability while leveraging cutting-edge technology.

### 7.1 Settlement Method Enum

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SettlementMethod {
    /// Arcium C-SPL confidential tokens (primary)
    CSPL,
    /// ShadowWire Bulletproof transfers (fallback)
    ShadowWire,
}
```

### 7.2 Settlement Account Structures

#### For C-SPL Settlement

```rust
/// User's confidential token account (C-SPL)
#[account]
pub struct UserConfidentialAccount {
    /// Associated user wallet
    pub owner: Pubkey,
    /// Confidential mint
    pub c_mint: Pubkey,
    /// Encrypted balance (ElGamal)
    pub encrypted_balance: [u8; 64],
    /// Pending incoming credits
    pub pending_balance: [u8; 64],
    /// Account bump
    pub bump: u8,
}
```

#### For ShadowWire Settlement

```rust
/// User's ShadowWire deposit record
#[account]
pub struct ShadowWireDeposit {
    /// Associated user wallet
    pub owner: Pubkey,
    /// Token type (SOL, USDC, etc.)
    pub token: TokenType,
    /// Commitment hash (Pedersen)
    pub commitment: [u8; 32],
    /// Nullifier for spend tracking
    pub nullifier: [u8; 32],
    /// Deposit timestamp
    pub deposited_at: i64,
    /// Account bump
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TokenType {
    SOL,
    USDC,
    USDT,
}
```

### 7.3 Dual Settlement Instruction

```rust
pub fn settle_trade(
    ctx: Context<SettleTrade>,
    method: SettlementMethod,
    buy_order: Pubkey,
    sell_order: Pubkey,
) -> Result<()> {
    match method {
        SettlementMethod::CSPL => settle_via_cspl(ctx, buy_order, sell_order),
        SettlementMethod::ShadowWire => settle_via_shadowwire(ctx, buy_order, sell_order),
    }
}
```

### 7.4 CPI to ShadowWire

```rust
/// Execute private transfer via ShadowWire
pub fn shadowwire_transfer(
    shadowwire_program: AccountInfo,
    sender: AccountInfo,
    recipient: AccountInfo,
    amount_commitment: [u8; 32],
    range_proof: Vec<u8>,  // Bulletproof range proof (~700 bytes)
    signature: [u8; 64],
) -> Result<()>
```

### 7.5 Settlement Accounts for Trading Pair

```rust
#[account]
pub struct TradingPairSettlement {
    /// Trading pair reference
    pub pair: Pubkey,

    /// C-SPL vaults (when using CSPL method)
    pub c_base_vault: Pubkey,
    pub c_quote_vault: Pubkey,

    /// ShadowWire pool addresses (when using ShadowWire method)
    pub sw_base_pool: Pubkey,
    pub sw_quote_pool: Pubkey,

    /// Active settlement method
    pub active_method: SettlementMethod,

    /// Fee recipient for ShadowWire (1% relayer fee)
    pub sw_fee_recipient: Pubkey,

    /// Account bump
    pub bump: u8,
}
```

### 7.6 Settlement Method Selection

The exchange admin can configure the active settlement method per trading pair:

```rust
pub fn set_settlement_method(
    ctx: Context<SetSettlementMethod>,
    pair: Pubkey,
    method: SettlementMethod,
) -> Result<()>
```

**Selection Criteria:**
| Criteria | C-SPL | ShadowWire |
|----------|-------|------------|
| Privacy Model | ElGamal + MPC | Bulletproofs ZK |
| Maturity | Testnet (new) | Production |
| Fee | Gas only | 1% relayer |
| Supported Tokens | Any SPL | 17 specific tokens |

---

## 8. Security Considerations

### 8.1 Access Control Matrix

| Instruction | Signer Required | Additional Checks |
|-------------|-----------------|-------------------|
| `initialize` | Authority | One-time only |
| `create_pair` | Authority | Mints must be valid |
| `update_fees` | Authority | Max fee limits |
| `update_blacklist` | Authority | - |
| `pause/unpause` | Authority | - |
| `wrap_tokens` | User | Sufficient balance |
| `unwrap_tokens` | User | Valid proof, owns account |
| `place_order` | Maker | Valid proof, not paused |
| `cancel_order` | Maker | Owns order |
| `match_orders` | Any (permissionless) | Orders matchable |

### 8.2 Reentrancy Protection

- All state updates occur BEFORE external CPIs
- Order status checked at instruction start
- Atomic settlement prevents partial execution

### 8.3 Arithmetic Safety

- All public arithmetic uses `checked_*` operations
- Encrypted arithmetic handled by Arcium (secure by design)
- Fee calculations bounded to prevent overflow

---

## 9. Testing Strategy

### 9.1 Unit Tests

| Test | Description |
|------|-------------|
| `test_initialize` | Exchange setup |
| `test_create_pair` | Pair creation |
| `test_wrap_unwrap` | Token wrapping round-trip |
| `test_place_order` | Order creation |
| `test_cancel_order` | Order cancellation |
| `test_match_orders` | Basic matching |
| `test_partial_fill` | Partial order fills |
| `test_access_control` | Permission checks |

### 9.2 Integration Tests

| Test | Description |
|------|-------------|
| `test_full_trade_flow` | Place → Match → Settle |
| `test_multiple_orders` | Order book behavior |
| `test_eligibility_flow` | ZK proof integration |
| `test_mpc_operations` | Arcium CPI |

### 9.3 Devnet Tests

| Test | Description |
|------|-------------|
| `test_real_arcium` | Live MPC cluster |
| `test_real_cspl` | Live C-SPL integration |
| `test_performance` | Latency benchmarks |

---

## 10. Deployment

### 10.1 Program IDs

| Program | Network | Address |
|---------|---------|---------|
| `confidex_dex` | Devnet | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` |
| `arcium_mxe` | Devnet | `CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE` |
| `eligibility_verifier` | Devnet | `6gXWoHY73B1zrPew9UimHoRzKL5Aq1E3DfrDc9ey3hxF` |
| `c_spl_program` | Devnet | Pending C-SPL testnet release |

### 10.2 Deployment Steps

1. Deploy eligibility verifier (Sunspot)
2. Deploy main DEX program
3. Initialize exchange state
4. Create initial trading pairs
5. Verify all CPIs working

---

## 11. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 10, 2026 | Zac | Initial document |
| 1.1 | Jan 15, 2026 | Claude | Added dual settlement architecture (Section 7), updated Program IDs with deployed addresses |
