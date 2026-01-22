# Advanced Order Types - Implementation Plan

**Status:** Planning Phase
**Priority:** P1 (Critical for Production)
**Estimated Effort:** 6-8 weeks total

This document outlines the comprehensive plan to implement advanced order types for Confidex, bridging the gap from the current hackathon MVP to a production-ready trading platform.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Gap Analysis](#2-gap-analysis)
3. [Order Type Specifications](#3-order-type-specifications)
4. [Architecture Design](#4-architecture-design)
5. [Implementation Phases](#5-implementation-phases)
6. [Technical Deep Dives](#6-technical-deep-dives)
7. [MPC Integration Requirements](#7-mpc-integration-requirements)
8. [Frontend Implementation](#8-frontend-implementation)
9. [Testing Strategy](#9-testing-strategy)
10. [Risk Assessment](#10-risk-assessment)

---

## 1. Current State Analysis

### 1.1 Existing Order Infrastructure

**Supported Order Types:**
| Type | Status | Description |
|------|--------|-------------|
| Limit | Live | Execute at specified price or better |
| Market | Live | Execute immediately at best price |

**Current ConfidentialOrder Structure (317 bytes):**
```rust
pub struct ConfidentialOrder {
    pub maker: Pubkey,              // 32 bytes
    pub pair: Pubkey,               // 32 bytes
    pub side: Side,                 // 1 byte (Buy/Sell)
    pub order_type: OrderType,      // 1 byte (Limit/Market)
    pub encrypted_amount: [u8; 64], // Arcium encrypted
    pub encrypted_price: [u8; 64],  // Arcium encrypted
    pub encrypted_filled: [u8; 64], // Arcium encrypted
    pub status: OrderStatus,        // 1 byte
    pub created_at: i64,            // 8 bytes
    pub order_id: u64,              // 8 bytes
    pub eligibility_proof_verified: bool,
    pub pending_match_request: [u8; 32],
    pub bump: u8,
}
```

**Order Statuses:**
- `Open` - Not yet filled
- `PartiallyFilled` - Partially executed
- `Filled` - Fully executed
- `Cancelled` - User cancelled
- `Matching` - Pending async MPC computation

### 1.2 Existing Infrastructure Strengths

| Component | Status | Reusability |
|-----------|--------|-------------|
| Async MPC callbacks | Live | High - can extend for triggers |
| PendingMatch tracking | Live | High - basis for conditional state |
| Pyth price streaming | Live | High - trigger evaluation ready |
| Encrypted amount/price | Live | High - supports encrypted triggers |
| Perpetuals liquidation | Live | Medium - pattern for conditional execution |

### 1.3 Key Files

| File | Purpose |
|------|---------|
| `programs/confidex_dex/src/state/order.rs` | Order struct, enums |
| `programs/confidex_dex/src/instructions/place_order.rs` | Order creation |
| `programs/confidex_dex/src/instructions/match_orders.rs` | Order matching |
| `programs/confidex_dex/src/cpi/arcium.rs` | MPC operations |
| `programs/confidex_dex/src/instructions/mpc_callback.rs` | MPC result handling |
| `frontend/src/hooks/use-pyth-price.ts` | Price feed streaming |
| `frontend/src/stores/order-store.ts` | Frontend order state |

---

## 2. Gap Analysis

### 2.1 Missing Order Types

| Order Type | Priority | Use Case | Complexity |
|------------|----------|----------|------------|
| **Stop-Loss** | P0 | Risk management, loss prevention | Medium |
| **Take-Profit** | P0 | Profit securing | Medium |
| **Stop-Limit** | P1 | Controlled stop execution | Medium |
| **OCO** | P1 | Combined SL/TP | High |
| **Trailing Stop** | P1 | Dynamic risk management | High |
| **Time-in-Force** | P0 | Order expiration (GTC/IOC/FOK) | Low |
| **Post-Only** | P2 | Maker fee optimization | Medium |
| **Reduce-Only** | P1 | Perpetuals position reduction | Low |
| **Iceberg** | P2 | Large order hiding | Medium |
| **TWAP** | P3 | Execution slicing | High |

### 2.2 Missing Infrastructure

| Component | Current State | Required For |
|-----------|---------------|--------------|
| **Trigger evaluation engine** | Not implemented | Stop-loss, take-profit |
| **Order expiry/TTL** | Not implemented | Time-in-force |
| **Order linking** | Not implemented | OCO orders |
| **Price-based triggers** | Partial (perps liquidation) | All conditional orders |
| **Keeper/crank system** | Not implemented | Trigger execution |
| **Order book indexing** | Not implemented | Post-only validation |

### 2.3 Privacy Considerations

**Challenge:** How do we evaluate trigger conditions while keeping order parameters private?

**Solution Approaches:**

| Approach | Privacy | Complexity | Latency |
|----------|---------|------------|---------|
| **Public trigger + encrypted amount** | Medium | Low | Low |
| **MPC trigger evaluation** | High | High | ~500ms |
| **Hybrid (threshold public, amount private)** | Medium-High | Medium | Low |

**Recommended:** Hybrid approach (same pattern as perpetuals liquidation)
- Trigger price: **Public** (enables keeper discovery)
- Order amount: **Encrypted** (maintains privacy)
- MPC verifies trigger matches encrypted order

---

## 3. Order Type Specifications

### 3.1 Stop-Loss Order

**Definition:** Automatically sell/buy when price reaches a threshold to limit losses.

```
Trigger Condition:
  - Long position/Buy order: Execute when mark_price <= stop_price
  - Short position/Sell order: Execute when mark_price >= stop_price

Execution:
  - Convert to market order when triggered
  - Or convert to limit order at specified price (stop-limit)
```

**Privacy Model:**
| Field | Visibility | Reason |
|-------|------------|--------|
| `stop_price` | PUBLIC | Keeper needs to discover |
| `limit_price` (if stop-limit) | ENCRYPTED | Trade execution privacy |
| `amount` | ENCRYPTED | Position size privacy |
| `triggered` | PUBLIC | Status tracking |

**Account Structure Extension:**
```rust
pub struct StopLossOrder {
    // Base order fields
    pub base: ConfidentialOrder,

    // Stop-loss specific
    pub trigger_price: u64,           // PUBLIC - for keeper discovery
    pub trigger_direction: TriggerDirection, // Above or Below
    pub execution_type: ExecutionType, // Market or Limit
    pub encrypted_limit_price: Option<[u8; 64]>, // If stop-limit
    pub triggered: bool,
    pub triggered_at: Option<i64>,
}

pub enum TriggerDirection {
    Above,  // Trigger when price >= trigger_price
    Below,  // Trigger when price <= trigger_price
}

pub enum ExecutionType {
    Market,
    Limit,
}
```

### 3.2 Take-Profit Order

**Definition:** Automatically close position when price reaches profit target.

```
Trigger Condition:
  - Long position: Execute when mark_price >= target_price
  - Short position: Execute when mark_price <= target_price

Execution:
  - Same as stop-loss, opposite direction
```

**Account Structure:** Same as StopLossOrder, different trigger logic.

### 3.3 OCO (One-Cancels-Other)

**Definition:** Pair of orders where execution of one cancels the other.

```
Typical Use Case:
  - Place stop-loss AND take-profit on same position
  - Whichever triggers first cancels the other
```

**Account Structure:**
```rust
pub struct OCOOrderPair {
    pub primary_order: Pubkey,   // Stop-loss
    pub secondary_order: Pubkey, // Take-profit
    pub position: Option<Pubkey>, // Linked position (perps)
    pub status: OCOStatus,
    pub created_at: i64,
    pub bump: u8,
}

pub enum OCOStatus {
    Active,
    PrimaryExecuted,
    SecondaryExecuted,
    BothCancelled,
}
```

### 3.4 Trailing Stop

**Definition:** Stop price that moves with favorable price movement.

```
Example (Long position):
  - Entry price: $100
  - Trail amount: $5
  - Initial stop: $95 (100 - 5)

  Price moves to $110:
  - New stop: $105 (110 - 5)

  Price drops to $108:
  - Stop stays at $105 (doesn't move down)

  Price drops to $105:
  - TRIGGERED - executes at market
```

**Account Structure:**
```rust
pub struct TrailingStopOrder {
    pub base: ConfidentialOrder,

    pub trail_amount: u64,         // PUBLIC - distance from peak
    pub trail_percent: Option<u16>, // Alternative: percentage
    pub current_stop_price: u64,   // PUBLIC - current trigger level
    pub peak_price: u64,           // Highest (long) or lowest (short) seen
    pub direction: TriggerDirection,
    pub triggered: bool,
}
```

**Challenge:** Requires continuous price monitoring and state updates.

### 3.5 Time-in-Force Options

**Definition:** Order lifetime/execution constraints.

| Type | Behavior |
|------|----------|
| **GTC** (Good-Til-Cancelled) | Remains until filled or cancelled |
| **IOC** (Immediate-or-Cancel) | Fill immediately, cancel remainder |
| **FOK** (Fill-or-Kill) | Fill entirely or cancel |
| **GTD** (Good-Til-Date) | Expires at specified time |

**Account Extension:**
```rust
pub enum TimeInForce {
    GTC,                    // Default (current behavior)
    IOC,                    // Immediate or cancel
    FOK,                    // Fill or kill
    GTD { expires_at: i64 }, // Good til date
}

// Add to ConfidentialOrder:
pub time_in_force: TimeInForce,
pub expires_at: Option<i64>,
```

### 3.6 Post-Only Order

**Definition:** Order that only adds liquidity (maker), never takes (taker).

```
Behavior:
  - If order would immediately match, it's cancelled
  - Ensures user pays maker fee (usually lower/rebate)
```

**Implementation:** Check at order placement if would cross spread.

### 3.7 Reduce-Only (Perpetuals)

**Definition:** Order can only reduce existing position, never increase.

```
Use Case:
  - User has 10 SOL long position
  - Reduce-only sell 5 SOL: Allowed (reduces to 5)
  - Reduce-only sell 15 SOL: Only fills 10 (closes position)
  - Reduce-only buy 5 SOL: Rejected (would increase)
```

**Implementation:**
```rust
pub struct ReduceOnlyOrder {
    pub base: ConfidentialOrder,
    pub position: Pubkey,        // Must reduce this position
    pub max_reduce_amount: [u8; 64], // Encrypted, <= position size
}
```

---

## 4. Architecture Design

### 4.1 Extended Order Type Hierarchy

```
                    ┌─────────────────────┐
                    │   BaseOrder         │
                    │  (common fields)    │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ StandardOrder │    │ ConditionalOrder │    │   OCOPair       │
│ (Limit/Market)│    │  (Stop/TP/Trail) │    │ (Order Linking) │
└───────────────┘    └─────────────────┘    └─────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
      ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐
      │ StopLoss    │  │ TakeProfit  │  │ TrailingStop    │
      └─────────────┘  └─────────────┘  └─────────────────┘
```

### 4.2 Trigger Evaluation System

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRIGGER EVALUATION FLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐     ┌──────────────┐     ┌────────────────┐      │
│  │  Pyth    │────▶│  Keeper Bot  │────▶│ Trigger Check  │      │
│  │  Oracle  │     │  (Off-chain) │     │  Instruction   │      │
│  └──────────┘     └──────────────┘     └───────┬────────┘      │
│                                                 │                │
│                                                 ▼                │
│                                        ┌───────────────┐        │
│                                        │ Public Price  │        │
│                                        │ vs Public     │        │
│                                        │ Trigger Check │        │
│                                        └───────┬───────┘        │
│                                                 │                │
│                          ┌──────────────────────┼───────────┐   │
│                          │ Triggered?           │           │   │
│                          │                      │           │   │
│                          ▼                      ▼           │   │
│                   ┌──────────┐           ┌──────────┐       │   │
│                   │   YES    │           │    NO    │       │   │
│                   └────┬─────┘           └──────────┘       │   │
│                        │                                    │   │
│                        ▼                                    │   │
│               ┌─────────────────┐                          │   │
│               │  MPC Verify     │                          │   │
│               │  (Optional for  │                          │   │
│               │   high-value)   │                          │   │
│               └────────┬────────┘                          │   │
│                        │                                    │   │
│                        ▼                                    │   │
│               ┌─────────────────┐                          │   │
│               │ Execute Order   │                          │   │
│               │ (Market/Limit)  │                          │   │
│               └─────────────────┘                          │   │
│                                                             │   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Keeper Bot Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      KEEPER BOT                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────┐    ┌───────────────┐    ┌────────────┐  │
│  │ Price Monitor │    │ Order Scanner │    │ TX Builder │  │
│  │ (Pyth SSE)    │    │ (RPC polling) │    │            │  │
│  └───────┬───────┘    └───────┬───────┘    └──────┬─────┘  │
│          │                    │                    │        │
│          ▼                    ▼                    │        │
│  ┌───────────────────────────────────────┐        │        │
│  │         Trigger Evaluator             │        │        │
│  │  - Compare price vs trigger levels    │        │        │
│  │  - Check time-based conditions        │        │        │
│  │  - Priority queue by profit           │        │        │
│  └───────────────────┬───────────────────┘        │        │
│                      │                            │        │
│                      ▼                            │        │
│  ┌───────────────────────────────────────┐        │        │
│  │         Execution Queue               │◀───────┘        │
│  │  - Batch transactions                 │                 │
│  │  - Priority fee optimization          │                 │
│  │  - MEV protection                     │                 │
│  └───────────────────────────────────────┘                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 New Program Instructions

```rust
// Conditional Order Instructions
pub mod instructions {
    // Order Placement
    pub fn place_stop_loss_order(ctx, params) -> Result<()>;
    pub fn place_take_profit_order(ctx, params) -> Result<()>;
    pub fn place_trailing_stop_order(ctx, params) -> Result<()>;
    pub fn place_oco_order(ctx, params) -> Result<()>;

    // Trigger Execution (called by keeper)
    pub fn execute_triggered_order(ctx, oracle_price) -> Result<()>;
    pub fn update_trailing_stop(ctx, new_peak_price) -> Result<()>;

    // OCO Management
    pub fn cancel_paired_order(ctx) -> Result<()>; // Auto-cancel on trigger

    // Time-based
    pub fn expire_orders(ctx, order_ids) -> Result<()>; // Crank for GTD
}
```

---

## 5. Implementation Phases

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Core infrastructure for conditional orders

**Tasks:**
1. **Extend OrderType enum**
   ```rust
   pub enum OrderType {
       Limit,
       Market,
       StopLoss,
       TakeProfit,
       StopLimit,
       TrailingStop,
   }
   ```

2. **Add TimeInForce to orders**
   - Update ConfidentialOrder struct
   - Add expiry checking logic
   - Create `expire_orders` instruction

3. **Create ConditionalOrder account structure**
   - Trigger price (public)
   - Trigger direction (above/below)
   - Execution type (market/limit)

4. **Pyth Oracle Integration (on-chain)**
   - Parse Pyth price in instructions
   - Add oracle account validation

**Deliverables:**
- [ ] Extended order structs
- [ ] Time-in-force implementation
- [ ] Basic trigger account structure
- [ ] Oracle price parsing

### Phase 2: Stop-Loss & Take-Profit (Weeks 3-4)

**Goal:** Functional stop-loss and take-profit orders

**Tasks:**
1. **Implement `place_stop_loss_order` instruction**
   - Validate trigger price
   - Store with public trigger, encrypted amount
   - Link to position (for perps)

2. **Implement `execute_triggered_order` instruction**
   - Verify oracle price vs trigger
   - Convert to market/limit order
   - Execute matching

3. **Implement MPC verification (optional)**
   - For high-value orders
   - Verify trigger matches encrypted parameters

4. **Keeper Bot v1**
   - Price monitoring
   - Trigger scanning
   - Transaction submission

**Deliverables:**
- [ ] Stop-loss placement instruction
- [ ] Take-profit placement instruction
- [ ] Trigger execution instruction
- [ ] Basic keeper bot

### Phase 3: OCO & Trailing Stop (Weeks 5-6)

**Goal:** Linked orders and dynamic stops

**Tasks:**
1. **Implement OCOOrderPair account**
   - Link two orders
   - Auto-cancel on trigger

2. **Implement TrailingStopOrder**
   - Peak price tracking
   - Dynamic stop level updates

3. **Implement `update_trailing_stop` instruction**
   - Called by keeper on favorable price movement
   - Update current_stop_price

4. **Enhance keeper bot**
   - OCO cancellation logic
   - Trailing stop updates
   - Batch processing

**Deliverables:**
- [ ] OCO order pair implementation
- [ ] Trailing stop implementation
- [ ] Enhanced keeper bot
- [ ] Integration tests

### Phase 4: Frontend & Polish (Weeks 7-8)

**Goal:** User-facing implementation and testing

**Tasks:**
1. **Frontend Components**
   - Conditional order form
   - Stop-loss/take-profit toggles
   - Trailing stop configuration
   - OCO builder

2. **Order Management UI**
   - Conditional order display
   - Trigger status indicators
   - Edit/cancel functionality

3. **Testing & Audit Prep**
   - Unit tests
   - Integration tests
   - Fuzzing
   - Documentation

**Deliverables:**
- [ ] Frontend components
- [ ] Complete test suite
- [ ] Documentation
- [ ] Audit-ready code

---

## 6. Technical Deep Dives

### 6.1 Public Trigger vs Encrypted Amount Pattern

This is the key privacy innovation, following the perpetuals liquidation pattern:

```rust
// Example: Stop-loss order placement
pub struct PlaceStopLossParams {
    // PUBLIC - enables keeper discovery
    pub trigger_price: u64,
    pub trigger_direction: TriggerDirection,

    // ENCRYPTED - maintains privacy
    pub encrypted_amount: [u8; 64],
    pub encrypted_limit_price: Option<[u8; 64]>,
}

// On-chain trigger check (no MPC needed for basic check)
fn check_trigger(
    current_price: u64,
    trigger_price: u64,
    direction: TriggerDirection,
) -> bool {
    match direction {
        TriggerDirection::Below => current_price <= trigger_price,
        TriggerDirection::Above => current_price >= trigger_price,
    }
}
```

**Privacy Analysis:**
- Keeper sees: trigger price, direction, that an order exists
- Keeper doesn't see: order amount, who placed it (maker can be hidden)
- On execution: amount remains encrypted during matching

### 6.2 Order State Machine

```
                    ┌─────────────┐
                    │   PLACED    │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │  PENDING    │ │  TRIGGERED  │ │  CANCELLED  │
    │  (waiting)  │ │             │ │  (by user)  │
    └──────┬──────┘ └──────┬──────┘ └─────────────┘
           │               │
           │               ▼
           │        ┌─────────────┐
           │        │  EXECUTING  │
           │        │  (matching) │
           │        └──────┬──────┘
           │               │
           │    ┌──────────┼──────────┐
           │    │          │          │
           ▼    ▼          ▼          ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │   EXPIRED   │ │   FILLED    │ │  PARTIALLY  │
    │   (GTD)     │ │             │ │   FILLED    │
    └─────────────┘ └─────────────┘ └─────────────┘
```

### 6.3 Keeper Incentive Model

**Problem:** Why would anyone run a keeper bot?

**Solutions:**
1. **Execution Fee**
   - Small fee paid to keeper on trigger execution
   - Funded from order's collateral or separate fee account

2. **Priority Access**
   - Keepers with staked tokens get priority
   - MEV protection through encrypted amounts

3. **Hybrid Model**
   ```rust
   pub struct KeeperReward {
       pub base_reward: u64,           // Fixed SOL amount
       pub percent_of_order: u16,      // Basis points of fill
       pub priority_fee_share: u16,    // Share of priority fee
   }
   ```

### 6.4 MEV Protection for Triggered Orders

**Risk:** Keepers see trigger prices, could front-run execution.

**Mitigations:**
1. **Encrypted execution price** - Keeper triggers but doesn't know fill price
2. **Commit-reveal for keepers** - Two-phase execution
3. **Slashing for manipulation** - Staked keepers lose stake
4. **Randomized keeper selection** - Auction-based assignment

---

## 7. MPC Integration Requirements

### 7.1 New MPC Operations Needed

| Operation | Inputs | Output | Use Case |
|-----------|--------|--------|----------|
| `verify_trigger_amount` | encrypted_amount, trigger_threshold | bool | Validate order size vs trigger |
| `calculate_stop_distance` | entry_price, stop_price, leverage | encrypted_loss | Risk calculation |
| `evaluate_trailing_peak` | current_price, peak_price, trail_amount | new_stop_price | Trailing stop update |

### 7.2 MPC Callback Extensions

```rust
// New callback types
pub enum TriggerCallbackType {
    TriggerVerified,      // MPC confirmed trigger matches params
    TrailingStopUpdated,  // New stop price calculated
    OCOPairEvaluated,     // Both orders evaluated
}

pub fn handle_trigger_callback(
    ctx: Context<TriggerCallback>,
    request_id: [u8; 32],
    callback_type: TriggerCallbackType,
    result: Vec<u8>,
) -> Result<()> {
    // Handle MPC result for triggered orders
}
```

### 7.3 When MPC is Required vs Optional

| Scenario | MPC Required? | Reason |
|----------|---------------|--------|
| Basic stop-loss trigger check | No | Public price vs public trigger |
| Verify encrypted amount >= minimum | Yes | Amount is encrypted |
| Trailing stop peak update | Optional | Can be done on-chain if trail is public |
| OCO cancel pairing | No | Just account state change |
| High-value order verification | Yes | Additional security |

---

## 8. Frontend Implementation

### 8.1 New Components

```typescript
// components/conditional-order-form.tsx
interface ConditionalOrderFormProps {
  pair: string;
  side: 'buy' | 'sell';
  position?: PositionData; // For reduce-only
}

// components/stop-loss-input.tsx
interface StopLossInputProps {
  currentPrice: number;
  side: 'long' | 'short';
  onTriggerPriceChange: (price: number) => void;
  onExecutionTypeChange: (type: 'market' | 'limit') => void;
}

// components/trailing-stop-config.tsx
interface TrailingStopConfigProps {
  entryPrice: number;
  trailType: 'amount' | 'percent';
  onTrailValueChange: (value: number) => void;
}

// components/oco-builder.tsx
interface OCOBuilderProps {
  position: PositionData;
  onStopLossSet: (params: StopLossParams) => void;
  onTakeProfitSet: (params: TakeProfitParams) => void;
}
```

### 8.2 Order Store Extensions

```typescript
// stores/order-store.ts extensions
interface ConditionalOrder extends Order {
  triggerPrice: number;
  triggerDirection: 'above' | 'below';
  executionType: 'market' | 'limit';
  limitPrice?: number;
  triggered: boolean;
  triggeredAt?: Date;
  linkedOrderId?: string; // For OCO
  trailingConfig?: {
    trailAmount?: number;
    trailPercent?: number;
    currentStopPrice: number;
    peakPrice: number;
  };
}

interface OrderStore {
  // Existing
  orders: Order[];

  // New
  conditionalOrders: ConditionalOrder[];
  ocoOrders: OCOOrderPair[];

  // Actions
  placeStopLoss: (params: StopLossParams) => Promise<string>;
  placeTakeProfit: (params: TakeProfitParams) => Promise<string>;
  placeOCO: (params: OCOParams) => Promise<string>;
  cancelConditionalOrder: (orderId: string) => Promise<void>;
}
```

### 8.3 UI/UX Considerations

**Order Entry Panel:**
```
┌─────────────────────────────────────┐
│  BUY SOL/USDC                       │
├─────────────────────────────────────┤
│  Order Type: [Limit ▼]              │
│                                     │
│  Amount: [______] SOL               │
│  Price:  [______] USDC              │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ [x] Stop-Loss               │    │
│  │     Trigger: [____] USDC    │    │
│  │     Type: [Market ▼]        │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ [x] Take-Profit             │    │
│  │     Trigger: [____] USDC    │    │
│  │     Type: [Limit ▼]         │    │
│  └─────────────────────────────┘    │
│                                     │
│  Time-in-Force: [GTC ▼]             │
│                                     │
│  [ Place Order ]                    │
└─────────────────────────────────────┘
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_trigger_direction_above() {
        assert!(check_trigger(105, 100, TriggerDirection::Above));
        assert!(!check_trigger(95, 100, TriggerDirection::Above));
    }

    #[test]
    fn test_trigger_direction_below() {
        assert!(check_trigger(95, 100, TriggerDirection::Below));
        assert!(!check_trigger(105, 100, TriggerDirection::Below));
    }

    #[test]
    fn test_trailing_stop_update() {
        let mut order = create_trailing_stop(100, 5); // Entry 100, trail 5
        assert_eq!(order.current_stop_price, 95);

        update_trailing_stop(&mut order, 110); // Price moves to 110
        assert_eq!(order.current_stop_price, 105);
        assert_eq!(order.peak_price, 110);

        update_trailing_stop(&mut order, 108); // Price drops to 108
        assert_eq!(order.current_stop_price, 105); // Doesn't move down
    }
}
```

### 9.2 Integration Tests

```typescript
describe('Conditional Orders', () => {
  describe('Stop-Loss', () => {
    it('should trigger when price drops below threshold', async () => {
      // Place stop-loss at $95
      const orderId = await placeStopLoss({
        triggerPrice: 95,
        triggerDirection: 'below',
        amount: 10,
        executionType: 'market',
      });

      // Simulate price drop to $94
      await simulatePriceUpdate(94);

      // Verify order triggered
      const order = await fetchOrder(orderId);
      expect(order.triggered).toBe(true);
      expect(order.status).toBe('filled');
    });

    it('should not trigger when price stays above threshold', async () => {
      const orderId = await placeStopLoss({
        triggerPrice: 95,
        triggerDirection: 'below',
        amount: 10,
      });

      await simulatePriceUpdate(96);

      const order = await fetchOrder(orderId);
      expect(order.triggered).toBe(false);
    });
  });

  describe('OCO Orders', () => {
    it('should cancel take-profit when stop-loss triggers', async () => {
      const { stopLossId, takeProfitId } = await placeOCO({
        stopLoss: { triggerPrice: 95 },
        takeProfit: { triggerPrice: 110 },
        amount: 10,
      });

      await simulatePriceUpdate(94); // Trigger stop-loss

      const stopLoss = await fetchOrder(stopLossId);
      const takeProfit = await fetchOrder(takeProfitId);

      expect(stopLoss.triggered).toBe(true);
      expect(takeProfit.status).toBe('cancelled');
    });
  });
});
```

### 9.3 Fuzzing

- Random price sequences
- Edge cases (exact trigger price)
- Concurrent trigger attempts
- State consistency under load

---

## 10. Risk Assessment

### 10.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Oracle manipulation | Medium | High | Multiple oracle sources, TWAP |
| Keeper centralization | Medium | Medium | Decentralized keeper network |
| MPC latency causing missed triggers | Low | Medium | Generous trigger windows |
| State bloat from conditional orders | Medium | Low | Order expiry, cleanup crank |

### 10.2 Economic Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Keeper griefing (not executing) | Medium | Medium | Incentive alignment, slashing |
| Trigger front-running | Medium | High | Encrypted amounts, commit-reveal |
| Cascading liquidations | Low | High | Circuit breakers, gradual execution |

### 10.3 Security Considerations

1. **Oracle Validation**
   - Verify Pyth signature on-chain
   - Check price staleness
   - Use EMA for trigger evaluation

2. **Reentrancy Protection**
   - Mark order as executing before external calls
   - Verify state after MPC callbacks

3. **Access Control**
   - Only keeper can call `execute_triggered_order`
   - Only owner can cancel pending triggers
   - Only linked position can use reduce-only

---

## Appendix A: Account Size Calculations

```
ConditionalOrder (proposed):
  Base ConfidentialOrder:     317 bytes
  trigger_price:                8 bytes
  trigger_direction:            1 byte
  execution_type:               1 byte
  encrypted_limit_price:       65 bytes (1 + 64 optional)
  triggered:                    1 byte
  triggered_at:                 9 bytes (1 + 8 optional)
  linked_order:                33 bytes (1 + 32 optional)
  trailing_config:             33 bytes (optional struct)
  ─────────────────────────────────────
  Total:                    ~468 bytes

OCOOrderPair:
  discriminator:                8 bytes
  primary_order:               32 bytes
  secondary_order:             32 bytes
  position:                    33 bytes (optional)
  status:                       1 byte
  created_at:                   8 bytes
  bump:                         1 byte
  ─────────────────────────────────────
  Total:                    ~115 bytes
```

---

## Appendix B: Event Definitions

```rust
#[event]
pub struct ConditionalOrderPlaced {
    pub order_id: u64,
    pub maker: Pubkey,
    pub pair: Pubkey,
    pub trigger_price: u64,
    pub trigger_direction: TriggerDirection,
    pub order_type: OrderType,
    pub timestamp: i64,
}

#[event]
pub struct OrderTriggered {
    pub order_id: u64,
    pub trigger_price: u64,
    pub mark_price: u64,
    pub keeper: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct OCOPairCreated {
    pub pair_id: u64,
    pub primary_order: Pubkey,
    pub secondary_order: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct OCOOrderCancelled {
    pub pair_id: u64,
    pub cancelled_order: Pubkey,
    pub triggered_order: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TrailingStopUpdated {
    pub order_id: u64,
    pub old_stop_price: u64,
    pub new_stop_price: u64,
    pub peak_price: u64,
    pub timestamp: i64,
}
```

---

## References

- [Current order.rs](../programs/confidex_dex/src/state/order.rs)
- [Perpetuals liquidation pattern](../programs/confidex_dex/src/instructions/perp_liquidate.rs)
- [Pyth integration](../frontend/src/hooks/use-pyth-price.ts)
- [Arcium MPC operations](../programs/confidex_dex/src/cpi/arcium.rs)
- [FUTURE_IMPLEMENTATIONS.md](./FUTURE_IMPLEMENTATIONS.md) - Overall roadmap
