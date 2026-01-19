# Phosphor Icons Reference

This file tracks Phosphor icons used in the project. When adding new icons, search [phosphoricons.com](https://phosphoricons.com) and document them here.

## Installation

```bash
pnpm add @phosphor-icons/react
```

## Usage

```tsx
import { IconName } from '@phosphor-icons/react';

// Basic usage
<IconName size={24} />

// With weight (thin, light, regular, bold, fill, duotone)
<IconName size={24} weight="bold" />

// With color
<IconName size={24} color="#fff" />
```

## Lucide to Phosphor Migration

All Lucide icons have been replaced with Phosphor equivalents. Key mappings:

| Lucide | Phosphor | Notes |
|--------|----------|-------|
| `Loader2` | `SpinnerGap` | Animated spinner |
| `Zap` | `Lightning` | Energy/fast |
| `AlertTriangle` | `Warning` | Warning indicator |
| `AlertCircle` | `WarningCircle` | Error/alert |
| `EyeOff` | `EyeSlash` | Hidden/private |
| `ExternalLink` | `ArrowSquareOut` | External link |
| `Twitter` | `XLogo` | Social media |
| `Link2` | `Link` | Link/connection |
| `RefreshCw` | `ArrowsClockwise` | Refresh/sync |
| `LogOut` | `SignOut` | Logout action |
| `Activity` | `Pulse` | Activity/live |
| `History` | `ClockCounterClockwise` | History/past |
| `Settings` | `GearSix` | Settings gear |
| `Sliders` | `SlidersHorizontal` | Settings/controls |
| `Monitor` | `Desktop` | Display/system |
| `ChevronRight` | `CaretRight` | Navigation |
| `ChevronDown` | `CaretDown` | Dropdown |
| `Wifi` | `WifiHigh` | Connected |
| `WifiOff` | `WifiSlash` | Disconnected |
| `Github` | `GithubLogo` | GitHub |
| `Search` | `MagnifyingGlass` | Search |
| `DollarSign` | `CurrencyDollar` | Currency |
| `Sparkles` | `Sparkle` | Highlight |
| `BarChart3` | `ChartBar` | Charts |
| `Droplets` | `Drop` | Liquidity |

## Icons Used in Project

| Icon | Import | Used In | Description |
|------|--------|---------|-------------|
| `StackSimple` | `import { StackSimple } from '@phosphor-icons/react'` | docs/page.tsx | Three-layer architecture |
| `FingerprintSimple` | `import { FingerprintSimple } from '@phosphor-icons/react'` | docs/page.tsx | ZK compliance/identity |
| `Cpu` | `import { Cpu } from '@phosphor-icons/react'` | docs/page.tsx | MPC execution/processing |
| `HardDrives` | `import { HardDrives } from '@phosphor-icons/react'` | docs/page.tsx | Settlement/storage |
| `GitBranch` | `import { GitBranch } from '@phosphor-icons/react'` | docs/page.tsx | Data flow |
| `ShieldChevron` | `import { ShieldChevron } from '@phosphor-icons/react'` | docs/page.tsx | Security model |
| `Code` | `import { Code } from '@phosphor-icons/react'` | docs/page.tsx | Programs/code |
| `Shield` | `import { Shield } from '@phosphor-icons/react'` | Various | Privacy/protection |
| `Lock` | `import { Lock } from '@phosphor-icons/react'` | Various | Encryption/secure |
| `Lightning` | `import { Lightning } from '@phosphor-icons/react'` | Various | Settlement/fast |
| `Check` | `import { Check } from '@phosphor-icons/react'` | Various | Success/complete |
| `SpinnerGap` | `import { SpinnerGap } from '@phosphor-icons/react'` | Various | Loading state |
| `WarningCircle` | `import { WarningCircle } from '@phosphor-icons/react'` | Various | Error/warning |
| `Clock` | `import { Clock } from '@phosphor-icons/react'` | Various | Time/pending |
| `X` | `import { X } from '@phosphor-icons/react'` | Various | Close/cancel |
| `Copy` | `import { Copy } from '@phosphor-icons/react'` | Various | Copy to clipboard |
| `ArrowSquareOut` | `import { ArrowSquareOut } from '@phosphor-icons/react'` | Various | External link |
| `GearSix` | `import { GearSix } from '@phosphor-icons/react'` | settings-panel | Settings |
| `SlidersHorizontal` | `import { SlidersHorizontal } from '@phosphor-icons/react'` | Various | Controls/filters |
| `Moon` | `import { Moon } from '@phosphor-icons/react'` | settings-panel | Dark mode |
| `Sun` | `import { Sun } from '@phosphor-icons/react'` | settings-panel | Light mode |
| `Desktop` | `import { Desktop } from '@phosphor-icons/react'` | settings-panel | System theme |
| `Info` | `import { Info } from '@phosphor-icons/react'` | Various | Information |
| `CaretDown` | `import { CaretDown } from '@phosphor-icons/react'` | Various | Dropdown |
| `CaretRight` | `import { CaretRight } from '@phosphor-icons/react'` | Various | Navigation |
| `TrendUp` | `import { TrendUp } from '@phosphor-icons/react'` | Various | Price up/buy |
| `TrendDown` | `import { TrendDown } from '@phosphor-icons/react'` | Various | Price down/sell |
| `ArrowUpRight` | `import { ArrowUpRight } from '@phosphor-icons/react'` | trade-history | Buy trade |
| `ArrowDownRight` | `import { ArrowDownRight } from '@phosphor-icons/react'` | trade-history | Sell trade |
| `ArrowsClockwise` | `import { ArrowsClockwise } from '@phosphor-icons/react'` | Various | Refresh |
| `WifiHigh` | `import { WifiHigh } from '@phosphor-icons/react'` | Various | Connected |
| `WifiSlash` | `import { WifiSlash } from '@phosphor-icons/react'` | Various | Disconnected |
| `Pulse` | `import { Pulse } from '@phosphor-icons/react'` | market-ticker | Live data |
| `Star` | `import { Star } from '@phosphor-icons/react'` | market-ticker | Favorite |
| `Wallet` | `import { Wallet } from '@phosphor-icons/react'` | wallet-button | Wallet |
| `SignOut` | `import { SignOut } from '@phosphor-icons/react'` | wallet-button | Disconnect |
| `Eye` | `import { Eye } from '@phosphor-icons/react'` | balance-display | Show balance |
| `EyeSlash` | `import { EyeSlash } from '@phosphor-icons/react'` | balance-display | Hide balance |
| `Warning` | `import { Warning } from '@phosphor-icons/react'` | confirm-dialog | Warning |
| `Fingerprint` | `import { Fingerprint } from '@phosphor-icons/react'` | page.tsx | ZK compliance |
| `EyeClosed` | `import { EyeClosed } from '@phosphor-icons/react'` | page.tsx | Privacy |
| `ShieldCheck` | `import { ShieldCheck } from '@phosphor-icons/react'` | page.tsx | MEV protection |
| `ArrowRight` | `import { ArrowRight } from '@phosphor-icons/react'` | page.tsx | Navigation |
| `GithubLogo` | `import { GithubLogo } from '@phosphor-icons/react'` | Various | GitHub link |
| `BookOpen` | `import { BookOpen } from '@phosphor-icons/react'` | Various | Documentation |
| `Plus` | `import { Plus } from '@phosphor-icons/react'` | predict/page | Add/create |
| `MagnifyingGlass` | `import { MagnifyingGlass } from '@phosphor-icons/react'` | predict/page | Search |
| `CurrencyDollar` | `import { CurrencyDollar } from '@phosphor-icons/react'` | predict/page | Money |
| `Sparkle` | `import { Sparkle } from '@phosphor-icons/react'` | predict/page | Highlight |
| `Calendar` | `import { Calendar } from '@phosphor-icons/react'` | Various | Date/time |
| `CheckCircle` | `import { CheckCircle } from '@phosphor-icons/react'` | Various | Success |
| `XCircle` | `import { XCircle } from '@phosphor-icons/react'` | Various | Error/cancel |
| `ChartBar` | `import { ChartBar } from '@phosphor-icons/react'` | predict/[id]/page | Charts |
| `Drop` | `import { Drop } from '@phosphor-icons/react'` | predict/[id]/page | Liquidity |
| `User` | `import { User } from '@phosphor-icons/react'` | predict/[id]/page | Creator |
| `ArrowLeft` | `import { ArrowLeft } from '@phosphor-icons/react'` | predict/[id]/page | Back |
| `ArrowDown` | `import { ArrowDown } from '@phosphor-icons/react'` | animations/page | Scroll down |

## Common Icons for Trading/DeFi

| Category | Icons |
|----------|-------|
| **Wallet/Finance** | `Wallet`, `CurrencyDollar`, `Bank`, `Coins`, `Money`, `Vault` |
| **Charts/Trading** | `ChartLine`, `ChartBar`, `TrendUp`, `TrendDown`, `ArrowsLeftRight`, `Swap` |
| **Security/Privacy** | `Lock`, `LockOpen`, `ShieldCheck`, `ShieldChevron`, `Eye`, `EyeSlash`, `Fingerprint` |
| **Actions** | `Lightning`, `Rocket`, `Play`, `Pause`, `Stop`, `ArrowRight` |
| **UI/Feedback** | `Copy`, `Check`, `X`, `Warning`, `Info`, `Question` |
| **Navigation** | `CaretDown`, `CaretRight`, `ArrowLeft`, `ArrowRight`, `House` |

## Weights

- `thin` - 1px stroke
- `light` - 1.5px stroke
- `regular` - 2px stroke (default)
- `bold` - 2.5px stroke
- `fill` - Solid filled
- `duotone` - Two-tone with opacity

## Notes

- Always search [phosphoricons.com](https://phosphoricons.com) for the correct icon name
- Some icons have `Simple` variants (e.g., `Stack` vs `StackSimple`)
- Prefer Phosphor over Lucide for consistency
- Document new icons in this file when adding them
