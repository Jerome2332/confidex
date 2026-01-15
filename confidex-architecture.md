# Confidex Architecture

```mermaid
flowchart TB
    subgraph User["👤 User"]
        Wallet[Solana Wallet]
        Browser[Browser/Frontend]
    end

    subgraph Frontend["Frontend Layer"]
        NextJS[Next.js App]
        NoirJS["Noir.js<br/>(ZK Proof Generation)"]
        ArciumSDK["Arcium SDK<br/>(Order Encryption)"]
    end

    subgraph Compliance["Layer 1: Compliance (Noir ZK)"]
        Circuit["Eligibility Circuit"]
        SMT["Sparse Merkle Tree<br/>(Blacklist)"]
        Verifier["On-chain Verifier<br/>(Groth16)"]
    end

    subgraph Execution["Layer 2: Execution (Arcium MPC)"]
        MPC["Arcium MPC Cluster"]
        PriceCompare["Encrypted Price<br/>Comparison"]
        FillCalc["Fill Amount<br/>Calculation"]
    end

    subgraph Settlement["Layer 3: Settlement (C-SPL)"]
        CSPL["C-SPL Program"]
        EncBalances["Encrypted Balances<br/>(Twisted ElGamal)"]
        ConfTransfer["Confidential<br/>Transfers"]
    end

    subgraph OnChain["Confidex Smart Contract"]
        DEX["confidex_dex Program"]
        ExchangeState["Exchange State"]
        Orders["Encrypted Orders"]
        Pairs["Trading Pairs"]
    end

    subgraph External["External Services"]
        Helius["Helius RPC<br/>+ Webhooks"]
    end

    %% User Flow
    Wallet --> Browser
    Browser --> NextJS

    %% Frontend Processing
    NextJS --> NoirJS
    NextJS --> ArciumSDK
    NoirJS -->|"Generate Proof<br/>(2-3s)"| Circuit
    ArciumSDK -->|"Encrypt Order"| MPC

    %% Compliance Flow
    Circuit --> SMT
    Circuit -->|"Proof"| Verifier
    Verifier -->|"Verify"| DEX

    %% Order Placement
    DEX --> Orders
    DEX --> ExchangeState
    DEX --> Pairs

    %% Execution Flow
    Orders -->|"Match Request"| MPC
    MPC --> PriceCompare
    PriceCompare --> FillCalc
    FillCalc -->|"Execute Trade"| DEX

    %% Settlement Flow
    DEX -->|"CPI"| CSPL
    CSPL --> EncBalances
    CSPL --> ConfTransfer

    %% External
    DEX <--> Helius

    %% Styling
    classDef userStyle fill:#e1f5fe,stroke:#01579b
    classDef frontendStyle fill:#f3e5f5,stroke:#4a148c
    classDef complianceStyle fill:#e8f5e9,stroke:#1b5e20
    classDef executionStyle fill:#fff3e0,stroke:#e65100
    classDef settlementStyle fill:#fce4ec,stroke:#880e4f
    classDef onchainStyle fill:#e3f2fd,stroke:#0d47a1
    classDef externalStyle fill:#f5f5f5,stroke:#616161

    class Wallet,Browser userStyle
    class NextJS,NoirJS,ArciumSDK frontendStyle
    class Circuit,SMT,Verifier complianceStyle
    class MPC,PriceCompare,FillCalc executionStyle
    class CSPL,EncBalances,ConfTransfer settlementStyle
    class DEX,ExchangeState,Orders,Pairs onchainStyle
    class Helius externalStyle
```

## Three-Layer Privacy Architecture

### Layer 1: Compliance (Noir ZK Proofs)
- **Purpose**: Prove trading eligibility without revealing identity
- **How**: Sparse Merkle Tree non-membership proof
- **Result**: User proves they're NOT on blacklist without exposing their address

### Layer 2: Execution (Arcium MPC)
- **Purpose**: Match orders without exposing prices or amounts
- **How**: Multi-party computation across distributed nodes
- **Operations**:
  - `buy_price >= sell_price` (encrypted comparison)
  - `min(buy_remaining, sell_remaining)` (fill calculation)
- **Result**: MEV-protected, private order matching

### Layer 3: Settlement (C-SPL Tokens)
- **Purpose**: Maintain encrypted balances on-chain
- **How**: Twisted ElGamal homomorphic encryption
- **Result**: Persistent privacy—balances never exposed publicly

## Data Flow

1. **User connects wallet** → Frontend
2. **Frontend generates ZK proof** → Proves eligibility (2-3 seconds)
3. **Frontend encrypts order** → Via Arcium SDK
4. **Submit transaction** → Proof + encrypted order params
5. **On-chain verification** → ZK proof checked by verifier
6. **Order stored** → Encrypted in program state
7. **Matching triggered** → Arcium MPC compares prices
8. **Settlement** → C-SPL confidential transfers execute
9. **Confirmation** → Helius webhooks notify frontend
