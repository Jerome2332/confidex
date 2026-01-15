# PRD-004: Frontend & User Experience

**Document ID:** PRD-004  
**Version:** 1.0  
**Date:** January 10, 2026  
**Parent Document:** PRD-001 Master Overview  

---

## 1. Overview

This document specifies the frontend architecture, user interface design, and user experience requirements for Confidex.

### 1.1 Design Principles

| Principle | Description |
|-----------|-------------|
| **Privacy-First** | Never expose sensitive data in UI; show encrypted indicators |
| **Simplicity** | Complex crypto abstracted from user; one-click operations |
| **Speed** | Optimistic UI updates; minimal loading states |
| **Trust** | Clear feedback on transaction status; transparent about privacy |

### 1.2 Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | Next.js 14 (App Router) | React with SSR/SSG |
| Language | TypeScript | Type safety |
| Styling | Tailwind CSS | Utility-first CSS |
| Components | shadcn/ui | Accessible component library |
| State | Zustand | Global state management |
| Data Fetching | TanStack Query | Server state + caching |
| Wallet | @solana/wallet-adapter | Wallet connection |
| RPC | Helius SDK | Solana interaction |
| ZK Proofs | @noir-lang/noir_js | Client-side proof generation |

---

## 2. Information Architecture

### 2.1 Site Map

```
Confidex
├── / (Landing Page)
├── /trade (Main Trading Interface)
│   ├── Order Form
│   ├── Order Book (Limited View)
│   ├── Open Orders
│   ├── Trade History
│   └── Balances
├── /wrap (Token Wrapping)
│   ├── Wrap (Public → Confidential)
│   └── Unwrap (Confidential → Public)
├── /portfolio (User Dashboard)
│   ├── Confidential Balances
│   ├── Order History
│   └── Trade Analytics
└── /settings
    ├── Preferences
    ├── RPC Selection
    └── Export Data
```

### 2.2 User Roles

| Role | Permissions | Notes |
|------|-------------|-------|
| **Anonymous** | View landing, connect wallet | No trading |
| **Connected** | Trade, wrap/unwrap, view portfolio | Standard user |
| **Admin** | Pause trading, update fees, update blacklist | Exchange operators |

---

## 3. Page Specifications

### 3.1 Landing Page (`/`)

#### Purpose
Explain Confidex's value proposition and convert visitors to users.

#### Sections

| Section | Content |
|---------|---------|
| **Hero** | "Trade Confidentially on Solana" + CTA button |
| **Problem** | Why privacy matters in DeFi (MEV, front-running) |
| **Solution** | How Confidex works (3 layers explanation) |
| **Features** | Key benefits with icons |
| **Security** | Trust model explanation |
| **CTA** | Connect Wallet button |
| **Footer** | Links, social, legal |

#### Visual Design

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo]                         [Docs] [GitHub] [Connect]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              🔒 Trade Confidentially                        │
│                 on Solana                                   │
│                                                             │
│    Hidden orders. Private balances. Zero MEV.               │
│                                                             │
│              [ Start Trading ]                              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│   🛡️ MEV Protected    🔐 Encrypted Orders   👁️ Private      │
├─────────────────────────────────────────────────────────────┤
│                   How It Works                              │
│   [1. Wrap] → [2. Trade] → [3. Settle] → [4. Unwrap]       │
└─────────────────────────────────────────────────────────────┘
```

---

### 3.2 Trade Page (`/trade`)

#### Purpose
Main trading interface where users place confidential orders.

#### Layout (Desktop)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [Logo]   SOL/USDC ▼   Market  Limit    [Settings]  [0x1a2b...3c4d] ▼  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────────────┐  ┌───────────────────────────────────────────┐ │
│  │    ORDER FORM      │  │              PRICE CHART                  │ │
│  │                    │  │                                           │ │
│  │  [Buy] [Sell]      │  │          📈 (TradingView Widget)          │ │
│  │                    │  │                                           │ │
│  │  Amount            │  │                                           │ │
│  │  ┌──────────────┐  │  │                                           │ │
│  │  │ 0.00     SOL │  │  │                                           │ │
│  │  └──────────────┘  │  │                                           │ │
│  │  [25%][50%][75%]   │  │                                           │ │
│  │  [MAX]             │  │                                           │ │
│  │                    │  │                                           │ │
│  │  Price (Limit)     │  └───────────────────────────────────────────┘ │
│  │  ┌──────────────┐  │                                                │
│  │  │ 0.00    USDC │  │  ┌───────────────────────────────────────────┐ │
│  │  └──────────────┘  │  │              ORDER BOOK                   │ │
│  │                    │  │  (Price levels only, amounts hidden)      │ │
│  │  Total             │  │                                           │ │
│  │  ≈ 0.00 USDC 🔒   │  │   Sell Orders     │     Buy Orders        │ │
│  │                    │  │   ████ 105.50    │     104.20 ████       │ │
│  │  [ Place Order ]   │  │   ███  105.25    │     104.00 ███        │ │
│  │                    │  │   ██   105.00    │     103.80 ██         │ │
│  │  🔐 Generating     │  │                                           │ │
│  │     proof...       │  └───────────────────────────────────────────┘ │
│  └────────────────────┘                                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  [ Open Orders ]  [ Order History ]  [ Balances ]                      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Pair     │ Side │ Type   │ Amount   │ Price    │ Status │ Action│   │
│  │ SOL/USDC │ Buy  │ Limit  │ 🔒 ***   │ 🔒 ***   │ Open   │[Cancel│   │
│  │ SOL/USDC │ Sell │ Market │ 🔒 ***   │ Market   │ Filled │  —    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Components

##### 3.2.1 Pair Selector

```typescript
interface PairSelectorProps {
  pairs: TradingPair[];
  selectedPair: TradingPair;
  onSelect: (pair: TradingPair) => void;
}

// Display: "SOL/USDC ▼" with dropdown
// Shows: pair name, 24h change (if available)
```

##### 3.2.2 Order Form

```typescript
interface OrderFormProps {
  pair: TradingPair;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  confidentialBalance: EncryptedBalance;
}

// States:
// - idle: Ready to enter order
// - generating_proof: ZK proof being generated (2-3 sec)
// - submitting: Transaction being sent
// - success: Order placed
// - error: Something went wrong
```

##### 3.2.3 Order Book (Limited View)

Since order amounts are confidential, we show:
- Price levels (visible)
- Number of orders at each level (visible)
- Relative depth indicator (bars without exact amounts)

```typescript
interface OrderBookProps {
  pair: TradingPair;
  buyOrders: OrderLevel[];  // { price: number, orderCount: number }
  sellOrders: OrderLevel[];
}
```

##### 3.2.4 Open Orders Table

```typescript
interface OpenOrdersTableProps {
  orders: ConfidentialOrder[];
  onCancel: (orderId: string) => void;
}

// Columns:
// - Pair
// - Side (Buy/Sell with color)
// - Type (Market/Limit)
// - Amount (🔒 icon + "Encrypted" or decrypted for owner)
// - Price (🔒 icon + "Encrypted" or decrypted for owner)
// - Status (Open/Partial/Filled)
// - Actions (Cancel button)
```

##### 3.2.5 Balance Display

```typescript
interface BalanceDisplayProps {
  publicBalance: number;
  confidentialBalance: EncryptedBalance;
  canDecrypt: boolean;
}

// Shows:
// Public: 100.00 SOL
// Confidential: 🔒 Click to reveal
// (After click): 50.00 SOL 🔒
```

---

### 3.3 Wrap/Unwrap Page (`/wrap`)

#### Purpose
Convert between public SPL tokens and confidential C-SPL tokens.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│                        WRAP TOKENS                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│    ┌─────────────────────────────────────────────────┐     │
│    │  [ Wrap ]  [ Unwrap ]                           │     │
│    └─────────────────────────────────────────────────┘     │
│                                                             │
│    From: Public Balance                                     │
│    ┌─────────────────────────────────────────────────┐     │
│    │  SOL ▼              │  100.00 ───────────[MAX] │     │
│    └─────────────────────────────────────────────────┘     │
│    Available: 150.00 SOL                                   │
│                                                             │
│                         ↓                                   │
│                                                             │
│    To: Confidential Balance                                 │
│    ┌─────────────────────────────────────────────────┐     │
│    │  🔒 SOL              │  100.00                  │     │
│    └─────────────────────────────────────────────────┘     │
│    Current: 🔒 50.00 SOL (click to reveal)                 │
│                                                             │
│    ─────────────────────────────────────────────────       │
│    Summary:                                                 │
│    You wrap:        100.00 SOL                             │
│    You receive:     100.00 🔒 SOL                          │
│    Network fee:     ~0.001 SOL                             │
│    ─────────────────────────────────────────────────       │
│                                                             │
│               [ Wrap Tokens ]                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 3.4 Portfolio Page (`/portfolio`)

#### Purpose
View all confidential balances and trading history.

#### Sections

| Section | Content |
|---------|---------|
| **Balances** | All tokens with public + confidential amounts |
| **Open Orders** | Active orders across all pairs |
| **Trade History** | Completed trades with timestamps |
| **Analytics** | Total volume, P&L (if computable) |

---

## 4. User Flows

### 4.1 First-Time User Flow

```
1. Land on homepage
   └── User reads value proposition
   
2. Click "Start Trading"
   └── Wallet connection modal appears
   
3. Select wallet (Phantom, Solflare, etc.)
   └── Approve connection in wallet
   
4. Connected state
   └── Redirect to /trade
   └── Show onboarding tooltip: "Wrap tokens to start trading"
   
5. Navigate to /wrap
   └── Enter amount, click "Wrap"
   └── Sign transaction
   
6. Tokens wrapped
   └── Toast: "Successfully wrapped 100 SOL"
   └── Navigate back to /trade
   
7. Place first order
   └── Enter amount/price
   └── See "Generating proof..." (2-3 sec)
   └── Click "Place Order"
   └── Sign transaction
   
8. Order placed
   └── Toast: "Order placed successfully"
   └── Order appears in Open Orders
```

### 4.2 Order Placement Flow

```
State Machine:

IDLE
  │
  ├── User enters amount/price
  │
  ▼
VALIDATING
  │
  ├── Check: Sufficient balance?
  ├── Check: Above minimum order?
  ├── Check: Valid price?
  │
  ▼
GENERATING_PROOF (2-3 seconds)
  │
  ├── Generate ZK eligibility proof
  ├── Show: "🔐 Generating privacy proof..."
  │
  ▼
READY_TO_SUBMIT
  │
  ├── Show: "[ Place Order ]" enabled
  │
  ▼
SUBMITTING
  │
  ├── Build transaction with encrypted params
  ├── Request wallet signature
  ├── Submit to Solana
  │
  ▼
SUCCESS or ERROR
  │
  ├── SUCCESS: Toast + add to Open Orders
  └── ERROR: Toast with error message
```

### 4.3 Balance Reveal Flow

Since confidential balances are encrypted, users must explicitly decrypt:

```
1. User sees: "Confidential: 🔒 Click to reveal"

2. User clicks
   └── Client-side decryption using ElGamal private key
   └── Key derived from wallet signature (one-time)

3. User sees: "Confidential: 50.00 SOL 🔒"
   └── Balance cached for session
   └── Never sent to server
```

---

## 5. Component Library

### 5.1 Core Components

| Component | Props | Description |
|-----------|-------|-------------|
| `Button` | variant, size, loading, disabled | Primary CTA component |
| `Input` | type, value, onChange, error | Form input with validation |
| `Select` | options, value, onChange | Dropdown selector |
| `Modal` | isOpen, onClose, title | Overlay dialog |
| `Toast` | type, message, duration | Notification popup |
| `Card` | title, children | Container with header |
| `Table` | columns, data, onRowClick | Data table |
| `Tabs` | tabs, activeTab, onChange | Tab navigation |
| `Tooltip` | content, children | Hover information |
| `Badge` | variant, children | Status indicator |

### 5.2 Domain Components

| Component | Props | Description |
|-----------|-------|-------------|
| `WalletButton` | - | Connect/disconnect wallet |
| `TokenAmount` | amount, token, encrypted | Formatted amount with icon |
| `ConfidentialBadge` | - | 🔒 indicator |
| `PairSelector` | pairs, selected, onSelect | Trading pair dropdown |
| `OrderForm` | pair, balance, onSubmit | Complete order entry |
| `OrderRow` | order, onCancel | Single order display |
| `ProofStatus` | status, progress | ZK proof generation indicator |
| `BalanceCard` | token, public, confidential | Balance display |

### 5.3 Component Examples

#### Button

```tsx
<Button variant="primary" size="lg" loading={isSubmitting}>
  Place Order
</Button>

<Button variant="secondary" size="sm" onClick={onCancel}>
  Cancel
</Button>

<Button variant="ghost" disabled>
  Coming Soon
</Button>
```

#### ConfidentialAmount

```tsx
<ConfidentialAmount
  amount={order.encryptedAmount}
  token="SOL"
  canReveal={isOwner}
  onReveal={handleReveal}
/>

// Renders:
// If not revealed: "🔒 Encrypted"
// If revealed: "100.00 SOL 🔒"
```

#### ProofStatus

```tsx
<ProofStatus status={proofState} />

// States:
// idle: null (not shown)
// generating: "🔐 Generating privacy proof..." with spinner
// ready: "✓ Proof ready" with green checkmark
// error: "✗ Proof failed" with red X
```

---

## 6. State Management

### 6.1 Global State (Zustand)

```typescript
// stores/wallet.ts
interface WalletStore {
  connected: boolean;
  publicKey: PublicKey | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

// stores/balance.ts
interface BalanceStore {
  publicBalances: Record<string, number>;
  confidentialBalances: Record<string, EncryptedBalance>;
  revealedBalances: Record<string, number>;
  fetchBalances: () => Promise<void>;
  revealBalance: (mint: string) => Promise<void>;
}

// stores/orders.ts
interface OrderStore {
  openOrders: ConfidentialOrder[];
  orderHistory: ConfidentialOrder[];
  fetchOrders: () => Promise<void>;
  placeOrder: (params: OrderParams) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;
}

// stores/trade.ts
interface TradeStore {
  selectedPair: TradingPair;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  amount: string;
  price: string;
  proofStatus: ProofStatus;
  setAmount: (amount: string) => void;
  setPrice: (price: string) => void;
  generateProof: () => Promise<void>;
}
```

### 6.2 Server State (TanStack Query)

```typescript
// hooks/useTradingPairs.ts
const useTradingPairs = () => {
  return useQuery({
    queryKey: ['tradingPairs'],
    queryFn: fetchTradingPairs,
    staleTime: 60_000, // 1 minute
  });
};

// hooks/useOrderBook.ts
const useOrderBook = (pairId: string) => {
  return useQuery({
    queryKey: ['orderBook', pairId],
    queryFn: () => fetchOrderBook(pairId),
    refetchInterval: 1000, // Every second
  });
};

// hooks/useOpenOrders.ts
const useOpenOrders = (wallet: PublicKey) => {
  return useQuery({
    queryKey: ['openOrders', wallet.toString()],
    queryFn: () => fetchOpenOrders(wallet),
    refetchInterval: 5000, // Every 5 seconds
  });
};
```

---

## 7. API Integration

### 7.1 Helius RPC

```typescript
// lib/helius.ts
import { Helius } from 'helius-sdk';

export const helius = new Helius(process.env.NEXT_PUBLIC_HELIUS_API_KEY);

// Get connection with priority fees
export const getConnection = () => {
  return new Connection(helius.rpcUrl, 'confirmed');
};

// Subscribe to account changes
export const subscribeToAccount = (
  pubkey: PublicKey,
  callback: (account: AccountInfo<Buffer>) => void
) => {
  return helius.connection.onAccountChange(pubkey, callback);
};
```

### 7.2 Webhooks

```typescript
// pages/api/webhooks/helius.ts
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { type, data } = req.body;
  
  switch (type) {
    case 'TRANSACTION':
      // Update order status
      await handleTransactionUpdate(data);
      break;
    case 'ACCOUNT_UPDATE':
      // Update balances
      await handleBalanceUpdate(data);
      break;
  }
  
  res.status(200).json({ received: true });
}
```

---

## 8. Performance Requirements

| Metric | Target | Measurement |
|--------|--------|-------------|
| Initial page load | < 2 seconds | Lighthouse |
| Time to interactive | < 3 seconds | Lighthouse |
| Proof generation feedback | < 500ms | User sees loading state |
| Order submission | < 5 seconds | Including proof + tx |
| Balance refresh | < 3 seconds | After transaction |
| Order book update | Every 1 second | Real-time data |

### 8.1 Optimization Strategies

1. **Code splitting:** Lazy load proof generation WASM
2. **Caching:** Cache trading pairs, token metadata
3. **Optimistic updates:** Show order in UI before confirmation
4. **Prefetching:** Prefetch order book data on pair hover
5. **Compression:** Gzip all API responses

---

## 9. Accessibility

### 9.1 Requirements

| Requirement | Implementation |
|-------------|----------------|
| Keyboard navigation | All interactive elements focusable |
| Screen reader support | ARIA labels on all components |
| Color contrast | WCAG AA compliance (4.5:1 ratio) |
| Focus indicators | Visible focus rings |
| Error messages | Associated with form fields |

### 9.2 Testing

- Lighthouse accessibility audit > 90
- Manual testing with VoiceOver/NVDA
- Keyboard-only navigation testing

---

## 10. Security Considerations

### 10.1 Client-Side Security

| Risk | Mitigation |
|------|------------|
| Private key exposure | Never log or transmit ElGamal private key |
| XSS attacks | Sanitize all user input; CSP headers |
| CSRF | SameSite cookies; verify origin |
| Sensitive data in memory | Clear on disconnect; no localStorage |

### 10.2 Privacy in UI

| Data | Treatment |
|------|-----------|
| Encrypted amounts | Show 🔒 icon; require explicit reveal |
| Transaction history | Filter to user's own transactions |
| Error messages | Generic messages; no sensitive details |
| Analytics | No tracking of trading activity |

---

## 11. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 10, 2026 | Zac | Initial document |
