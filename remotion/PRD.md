# PRD: Confidex Marketing Videos with Remotion

## Overview

Create a suite of professional marketing videos showcasing Confidex's UI components and three-layer privacy architecture using Remotion (React-based video creation).

---

## Distribution Strategy

**Primary Channel:** Social Media (Twitter/X, TikTok, YouTube Shorts)
- Optimize for mobile viewing
- Design for muted autoplay (text overlays essential)
- Create vertical (9:16) and horizontal (16:9) variants

**Audio:** AI Voiceover (ElevenLabs)
- Professional male or female voice
- Concise, punchy script
- Background music underneath VO
- Export versions with/without VO for flexibility

**First Priority:** Hero Video (60s) - Full marketing video for launch

---

## Directory Structure

```
/remotion/
├── remotion.config.ts          # Remotion configuration
├── package.json                # Dependencies
├── tsconfig.json               # TypeScript config
├── tailwind.config.ts          # Tailwind (matches frontend)
├── public/
│   ├── fonts/                  # Custom fonts
│   ├── images/                 # Screenshots, logos
│   └── audio/                  # Background music, SFX
├── src/
│   ├── Root.tsx                # Composition registry
│   ├── index.ts                # Entry point
│   ├── compositions/
│   │   ├── HeroVideo.tsx       # Main marketing video
│   │   ├── PrivacyExplainer.tsx
│   │   ├── TradingDemo.tsx
│   │   ├── PerpetualsDemo.tsx
│   │   └── FeatureHighlight.tsx
│   ├── components/
│   │   ├── ui/                 # Cloned from frontend
│   │   │   ├── PrivacyIndicator.tsx
│   │   │   ├── EncryptedValue.tsx
│   │   │   ├── OrderProgress.tsx
│   │   │   └── TradingPanel.tsx
│   │   └── video/              # Video-specific
│   │       ├── SceneTransition.tsx
│   │       ├── TextReveal.tsx
│   │       ├── PrivacyLayerAnimation.tsx
│   │       └── MockDataFlow.tsx
│   ├── scenes/
│   │   ├── IntroScene.tsx
│   │   ├── ProblemScene.tsx
│   │   ├── SolutionScene.tsx
│   │   ├── Layer1Scene.tsx     # ZK Proofs
│   │   ├── Layer2Scene.tsx     # MPC Matching
│   │   ├── Layer3Scene.tsx     # Settlement
│   │   ├── DemoScene.tsx
│   │   └── CTAScene.tsx
│   ├── hooks/
│   │   ├── useAnimatedValue.ts
│   │   └── useSequenceProgress.ts
│   └── lib/
│       ├── constants.ts        # Timing, colors
│       └── animations.ts       # Shared spring configs
└── renders/                    # Export directory
    ├── hero-video.mp4
    ├── privacy-explainer.mp4
    └── social/
        ├── twitter-clip.mp4
        └── tiktok-vertical.mp4
```

---

## Video Compositions

### 1. Hero Video (60 seconds)

**Purpose:** Main marketing video for landing page and YouTube

**Dimensions:** 1920x1080 @ 30fps (1800 frames)

**Scenes:**

| Scene | Duration | Content |
|-------|----------|---------|
| **Intro** | 0-5s | Logo reveal + "The First Private DEX on Solana" |
| **Problem** | 5-15s | Current DEX issues: MEV, front-running, visible orders |
| **Solution** | 15-25s | Confidex introduction with 3-layer architecture overview |
| **Layer 1** | 25-32s | ZK Proofs - "Prove Eligibility, Reveal Nothing" |
| **Layer 2** | 32-40s | MPC Matching - "Encrypted Price Comparison" |
| **Layer 3** | 40-47s | Settlement - "Private Transfers" |
| **Demo** | 47-55s | UI walkthrough with animated trading panel |
| **CTA** | 55-60s | "Trade Privately Today" + links |

**Key Animations:**
- Privacy architecture diagram building layer by layer
- Encrypted value blur/reveal transitions
- Order flow visualization (client → on-chain → MPC → settlement)
- Lock icons animating to show encryption states

---

### 2. Privacy Explainer (45 seconds)

**Purpose:** Educational video explaining the three-layer architecture

**Dimensions:** 1920x1080 @ 30fps

**Scenes:**

| Scene | Duration | Content |
|-------|----------|---------|
| **Hook** | 0-5s | "Your trades are being watched" |
| **Layer 1: ZK** | 5-18s | Noir circuit visualization, proof generation |
| **Layer 2: MPC** | 18-31s | Arcium cluster nodes, encrypted comparison |
| **Layer 3: C-SPL** | 31-40s | Token transfer with hidden amounts |
| **Summary** | 40-45s | All three layers combined flow |

**Key Animations:**
- Merkle tree construction with Poseidon hashing
- MPC node network with encrypted data flowing
- Balance updates with lock icons

---

### 3. Trading Demo (30 seconds)

**Purpose:** Quick demo of the trading interface

**Dimensions:** 1920x1080 @ 30fps

**Content:**
- Spot trading interface walkthrough
- Order placement with privacy indicators
- 3-layer progress visualization (OrderProgress component)
- Balance display with encrypted values

---

### 4. Perpetuals Demo (30 seconds)

**Purpose:** Showcase perpetuals trading features

**Content:**
- Leverage selector animation (1x → 10x)
- Long/Short position entry
- Encrypted liquidation thresholds
- Position management UI

---

### 5. Social Clips (15 seconds each)

**Twitter/X Format:** 1280x720 @ 30fps
**TikTok/Reels:** 1080x1920 @ 30fps (vertical)

**Clip A:** "Your orders are encrypted" - Lock animation
**Clip B:** "ZK proofs in 2 seconds" - Proof generation
**Clip C:** "Trade without revealing prices" - MPC visualization

---

### 6. Vertical Hero Video (60 seconds)

**Purpose:** TikTok/Reels/Shorts optimized version of Hero Video

**Dimensions:** 1080x1920 @ 30fps (9:16 aspect ratio)

**Adaptations from horizontal:**
- UI components scaled and repositioned for vertical canvas
- Text overlays larger (readable on mobile)
- Split complex scenes into stacked layouts
- Trading panel fills more screen real estate
- Privacy architecture diagram vertical stack (top to bottom)

**Scene Layout Changes:**

| Scene | Horizontal | Vertical Adaptation |
|-------|------------|---------------------|
| Intro | Logo centered | Logo top-third, tagline below |
| Problem | 3 cards horizontal | 3 cards stacked vertically |
| Solution | Architecture diagram | Vertical flow diagram |
| Layer 1-3 | Wide visualization | Full-height animations |
| Demo | Side-by-side UI | Trading panel centered, full width |
| CTA | Horizontal badges | Stacked CTA buttons |

---

## UI Components to Animate

### From Frontend (Clone & Adapt)

| Component | Source | Video Adaptation |
|-----------|--------|------------------|
| `PrivacyIndicator` | `frontend/src/components/privacy-indicator.tsx` | Animate status transitions |
| `EncryptedValue` | `frontend/src/components/encrypted-value.tsx` | Blur → reveal animation |
| `OrderProgress` | `frontend/src/components/order-progress.tsx` | Step-by-step progress |
| `PrivacyArchitecture` | `frontend/src/components/privacy-architecture.tsx` | Layer-by-layer build |
| `TradingPanel` | `frontend/src/components/trading-panel.tsx` | Simulated order entry |
| `OrderBook` | `frontend/src/components/order-book.tsx` | Animated bid/ask updates |
| `CircleAnimation` | `frontend/src/components/circle-animations.tsx` | Background effects |
| `ConicBorderAnimation` | `frontend/src/components/conic-border-animation.tsx` | Card highlights |

### Video-Specific Components

| Component | Purpose |
|-----------|---------|
| `PrivacyLayerAnimation` | 3-layer stack with animated connections |
| `MockDataFlow` | Animated data packets between nodes |
| `EncryptionVisual` | Lock icon + cipher text transformation |
| `MerkleTreeViz` | Animated tree with hash nodes |
| `NodeNetwork` | MPC cluster visualization |
| `TextReveal` | Character-by-character or word-by-word |

---

## Privacy Feature Visualizations

### Layer 1: ZK Proofs (Noir + Sunspot)

**Visual Elements:**
- Merkle tree building animation (20 levels)
- Poseidon hash function visualization
- Proof generation progress (0% → 100%)
- 324-byte proof appearing as hex stream
- Shield icon with checkmark on verification

**Text Overlays:**
- "Prove eligibility without revealing identity"
- "324-byte Groth16 proof"
- "Verified in <200K compute units"

---

### Layer 2: MPC Matching (Arcium Cerberus)

**Visual Elements:**
- Four Arx nodes in diamond formation
- Encrypted order packets flowing between nodes
- Price comparison animation (without revealing values)
- Lock icons on all data paths
- Result returning (match/no match)

**Text Overlays:**
- "Prices compared without decryption"
- "Dishonest majority secure"
- "No single point of failure"

---

### Layer 3: Confidential Settlement

**Visual Elements:**
- Token transfer animation with hidden amounts
- ShadowWire/C-SPL badge
- Balance update with encrypted indicator
- Checkmark on completion

**Text Overlays:**
- "Transfer complete, amount private"
- "Only you know your balance"

---

## Design System (Matches Frontend)

### Colors

```typescript
const colors = {
  background: '#000000',
  surface: {
    5: 'rgba(255,255,255,0.05)',
    10: 'rgba(255,255,255,0.10)',
    20: 'rgba(255,255,255,0.20)',
  },
  text: {
    primary: '#FFFFFF',
    secondary: 'rgba(255,255,255,0.60)',
    muted: 'rgba(255,255,255,0.40)',
  },
  border: {
    subtle: 'rgba(255,255,255,0.10)',
    emphasis: 'rgba(255,255,255,0.20)',
  },
  accent: {
    buy: {
      bg: 'rgba(16,185,129,0.20)',
      text: 'rgba(52,211,153,0.80)',
      border: 'rgba(16,185,129,0.30)',
    },
    sell: {
      bg: 'rgba(244,63,94,0.20)',
      text: 'rgba(251,113,133,0.80)',
      border: 'rgba(244,63,94,0.30)',
    },
    privacy: {
      full: '#34D399',    // emerald-400
      active: '#FFFFFF',
      complete: '#10B981', // emerald-500
    },
  },
};
```

### Typography

```typescript
const typography = {
  hero: { size: 72, weight: 300, family: 'Inter' },
  h1: { size: 48, weight: 300, family: 'Inter' },
  h2: { size: 36, weight: 300, family: 'Inter' },
  body: { size: 24, weight: 300, family: 'Inter' },
  mono: { size: 18, weight: 400, family: 'JetBrains Mono' },
};
```

### Animation Presets

```typescript
const springs = {
  smooth: { damping: 200 },
  snappy: { damping: 20, stiffness: 200 },
  bouncy: { damping: 8 },
  heavy: { damping: 15, stiffness: 80, mass: 2 },
};

const timing = {
  fadeIn: 15,      // frames
  slideIn: 20,
  sceneTransition: 30,
  textReveal: 2,   // frames per character
};
```

---

## Scenes Breakdown

### IntroScene.tsx

```
Frame 0-30: Black screen
Frame 30-60: Logo fade in (center)
Frame 60-90: Logo scale up slightly
Frame 90-120: Tagline typewriter: "The First Private DEX on Solana"
Frame 120-150: Privacy badge fade in below
```

### ProblemScene.tsx

```
Frame 0-30: "The Problem" title slide in
Frame 30-90: Three problem cards animate in staggered:
  1. "MEV Extraction" - Bot icon
  2. "Front-Running" - Clock icon
  3. "Visible Orders" - Eye icon
Frame 90-150: Cards shake/glitch effect
Frame 150-180: Fade to black
```

### Layer1Scene.tsx (ZK Proofs)

```
Frame 0-30: "Layer 1: ZK Compliance" title
Frame 30-90: Merkle tree building animation
Frame 90-150: Proof generation progress bar
Frame 150-180: Shield + checkmark animation
Frame 180-210: "Eligibility proven, identity hidden" text
```

### Layer2Scene.tsx (MPC)

```
Frame 0-30: "Layer 2: MPC Matching" title
Frame 30-60: Four Arx nodes appear in corners
Frame 60-120: Encrypted packets flow between nodes
Frame 120-150: Center "Match Found" indicator
Frame 150-180: Lock icons pulse green
```

### Layer3Scene.tsx (Settlement)

```
Frame 0-30: "Layer 3: Private Settlement" title
Frame 30-90: Token transfer animation
Frame 90-120: Amount hidden with lock icon
Frame 120-150: "Transfer Complete" checkmark
```

### DemoScene.tsx

```
Frame 0-30: Trading UI slides in from right
Frame 30-60: Mouse cursor moves to Buy button
Frame 60-90: Click animation, OrderProgress appears
Frame 90-150: Progress through 4 steps
Frame 150-180: "Order Placed Privately" toast
```

---

## Implementation Plan

### Phase 1: Setup (Day 1)

1. Initialize Remotion project in `/remotion`
2. Configure Tailwind to match frontend
3. Clone essential UI components
4. Set up font loading (Inter, JetBrains Mono)

### Phase 2: Core Components (Day 2-3)

1. Build `PrivacyLayerAnimation` component
2. Build `MockDataFlow` for MPC visualization
3. Build `TextReveal` with typewriter effect
4. Build `EncryptionVisual` for lock animations

### Phase 3: Scenes (Day 4-6)

1. Implement all 8 scenes
2. Add transitions between scenes
3. Fine-tune timing and animations
4. Add background music/SFX

### Phase 4: Compositions (Day 7)

1. Assemble Hero Video
2. Assemble Privacy Explainer
3. Create social clips (cropped/reformatted)

### Phase 5: Export & QA (Day 8)

1. Render all compositions
2. Review for timing/visual issues
3. Export multiple formats (MP4, WebM)
4. Optimize file sizes

---

## Technical Requirements

### Dependencies

```json
{
  "dependencies": {
    "@remotion/cli": "^4.0.0",
    "@remotion/player": "^4.0.0",
    "@remotion/transitions": "^4.0.0",
    "@remotion/layout-utils": "^4.0.0",
    "@remotion/google-fonts": "^4.0.0",
    "remotion": "^4.0.0",
    "tailwindcss": "^3.4.0",
    "@phosphor-icons/react": "^2.0.0"
  }
}
```

### Render Commands

```bash
# Preview
npx remotion studio

# Render Hero Video
npx remotion render src/index.ts HeroVideo renders/hero-video.mp4

# Render all
npx remotion render src/index.ts --all
```

---

## Voiceover Script (Hero Video - 60s)

**Total word count:** ~150 words (2.5 words/second)

```
[0-5s] INTRO
"Your trades are being watched."

[5-15s] PROBLEM
"Every order you place on a DEX is visible. Bots front-run you.
MEV extracts value. Your strategy is exposed."

[15-25s] SOLUTION
"Confidex changes everything. The first fully private DEX on Solana.
Three layers of cryptographic protection."

[25-32s] LAYER 1
"Layer one: Zero-knowledge proofs. Prove you're eligible without
revealing who you are."

[32-40s] LAYER 2
"Layer two: Encrypted matching. Your orders are compared without
ever being decrypted. Not even by us."

[40-47s] LAYER 3
"Layer three: Confidential settlement. Token transfers with
hidden amounts."

[47-55s] DEMO
"Place orders in seconds. Watch your privacy in real-time.
Full encryption, zero compromise."

[55-60s] CTA
"Trade privately. Confidex. Live on Solana."
```

**Voice Style:** Confident, modern, slightly urgent. Think "Netflix documentary" tone.

**ElevenLabs Settings:**
- Voice: Adam (or Rachel for female)
- Stability: 0.5
- Similarity Boost: 0.75
- Style: 0.3

---

## Social Media Clip Scripts (15s each)

**Clip A: "Invisible Orders"**
```
"Your orders are invisible. Encrypted before they hit the chain.
No front-running. No MEV. Just privacy."
```

**Clip B: "2-Second Proofs"**
```
"Zero-knowledge proofs. Generated in two seconds.
Verified on Solana. Your identity? Hidden."
```

**Clip C: "Encrypted Matching"**
```
"Prices compared without decryption. Four nodes. One answer.
No one sees your limit price."
```

---

## Success Metrics

- Hero video < 10MB (optimized for web)
- Social clips < 2MB each
- All animations smooth at 30fps
- Consistent with brand guidelines
- Clear privacy messaging
- Professional production quality
- AI voiceover sounds natural (not robotic)

---

## Files to Create

1. `/remotion/package.json` - Project dependencies
2. `/remotion/remotion.config.ts` - Remotion config
3. `/remotion/tailwind.config.ts` - Tailwind config
4. `/remotion/src/Root.tsx` - Composition registry
5. `/remotion/src/lib/constants.ts` - Colors, timing, springs
6. `/remotion/src/components/video/PrivacyLayerAnimation.tsx`
7. `/remotion/src/components/video/TextReveal.tsx`
8. `/remotion/src/scenes/*.tsx` - All scene components
9. `/remotion/src/compositions/HeroVideo.tsx`

---

## Verification

1. Run `npx remotion studio` in `/remotion`
2. Preview each composition in browser
3. Check animation smoothness
4. Verify text readability
5. Test exports at different resolutions
6. Validate file sizes meet targets
