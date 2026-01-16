# Confidex Brand Guidelines

A comprehensive design system for maintaining visual consistency across the Confidex platform.

## Philosophy

Confidex uses a **monochrome-first** design philosophy that emphasizes:
- **Privacy & Security**: Dark theme conveys sophistication and security
- **Clarity**: High contrast ensures readability
- **Minimalism**: Clean lines and light font weights create an elegant feel
- **Functional Accents**: Subtle color hints for trading actions without overwhelming the design

---

## Color Palette

### Core Monochrome Colors

| Token | Tailwind Class | Use Case |
|-------|---------------|----------|
| Background | `bg-black` | Page backgrounds, main containers |
| Surface 1 | `bg-white/5` | Cards, elevated surfaces |
| Surface 2 | `bg-white/10` | Hover states, active surfaces |
| Surface 3 | `bg-white/20` | Selected states, emphasis |

### Text Colors

| Token | Tailwind Class | Use Case |
|-------|---------------|----------|
| Primary | `text-white` | Headings, important content |
| Secondary | `text-white/60` | Body text, descriptions |
| Tertiary | `text-white/50` | Supporting text |
| Muted | `text-white/40` | Disabled, placeholder text |

### Border Colors

| Token | Tailwind Class | Use Case |
|-------|---------------|----------|
| Subtle | `border-white/10` | Default borders, dividers |
| Visible | `border-white/20` | Hover states, emphasis |
| Emphasis | `border-white/30` | Active states, focus |

### Button Styles

**Primary Button (CTA)**
```
bg-white text-black font-medium rounded-lg
hover:bg-white/90
shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20
```

**Secondary Button**
```
bg-white/10 text-white font-medium rounded-lg border border-white/20
hover:bg-white/20
```

**Ghost Button**
```
text-white/60 hover:text-white hover:bg-white/10 rounded-lg
```

---

## Trading UI Accent Colors

For trading interfaces, we use **subtle muted accents** to distinguish buy/sell actions while maintaining the monochrome aesthetic.

### Buy/Long (Emerald)

| Token | Tailwind Class | Use Case |
|-------|---------------|----------|
| Background | `bg-emerald-500/20` | Button backgrounds, badges |
| Text | `text-emerald-400/80` | Labels, price text |
| Border | `border-emerald-500/30` | Button borders, highlights |
| Hover BG | `bg-emerald-500/30` | Hover states |

### Sell/Short (Rose)

| Token | Tailwind Class | Use Case |
|-------|---------------|----------|
| Background | `bg-rose-500/20` | Button backgrounds, badges |
| Text | `text-rose-400/80` | Labels, price text |
| Border | `border-rose-500/30` | Button borders, highlights |
| Hover BG | `bg-rose-500/30` | Hover states |

### Price Movement Indicators

For price changes, rely primarily on **icons** with subtle text differentiation:
- **Positive**: `text-white` with TrendingUp icon
- **Negative**: `text-white/60` with TrendingDown icon

### Warning States

```
bg-white/10 border-white/30 text-white/80
```

For high-risk warnings (e.g., high leverage):
```
text-rose-400/80
```

---

## Typography

### Font Family
**Inter** - Clean, modern sans-serif optimized for UI

### Type Scale

| Level | Class | Use Case |
|-------|-------|----------|
| H1 | `text-4xl md:text-6xl lg:text-7xl font-light` | Hero headings |
| H2 | `text-3xl md:text-4xl font-light` | Section headings |
| H3 | `text-xl font-normal` | Subsection headings |
| H4 | `text-lg font-normal` | Card titles |
| Body Large | `text-lg md:text-xl font-light` | Introductions, hero subtitle |
| Body | `text-base font-light` | Standard paragraphs |
| Body Small | `text-sm font-light` | Supporting text |
| Caption | `text-xs font-light` | Labels, timestamps |
| Monospace | `font-mono` | Prices, addresses, numbers |

### Font Weights

| Weight | Class | Use Case |
|--------|-------|----------|
| Light (300) | `font-light` | Headings, body text |
| Normal (400) | `font-normal` | Subheadings, feature titles |
| Medium (500) | `font-medium` | Buttons, nav items |

---

## Spacing

### Container
```
container mx-auto px-4
```

### Section Padding
```
py-20 md:py-32
```

### Common Gaps
- `gap-2` (8px) - Tight spacing
- `gap-3` (12px) - Compact elements
- `gap-4` (16px) - Standard spacing
- `gap-6` (24px) - Relaxed spacing
- `gap-8` (32px) - Section-level gaps

---

## Border Radius

| Element | Class |
|---------|-------|
| Buttons | `rounded-lg` |
| Cards | `rounded-xl` |
| Badges/Pills | `rounded-full` |
| Inputs | `rounded-lg` |
| Modals | `rounded-xl` |

---

## Effects

### Glass Effect (Header)
```
backdrop-blur supports-[backdrop-filter]:bg-black/60
```

### Glow Shadow
```
shadow-lg shadow-white/10
hover:shadow-xl hover:shadow-white/20
```

### Hero Blur Orbs
```
absolute bg-white/5 rounded-full blur-3xl
```
Typical sizes: `w-[400px] h-[400px]`, `w-[500px] h-[500px]`

### Transitions
- Color changes: `transition-colors`
- All properties: `transition-all`
- Transform: `transition-transform`

Duration: Default Tailwind (150ms)

---

## Component Patterns

### Card
```jsx
<div className="p-6 bg-white/5 border border-white/10 rounded-xl hover:border-white/20 transition-colors">
  {/* content */}
</div>
```

### Badge/Pill
```jsx
<span className="inline-flex items-center px-2 py-1 text-xs font-light bg-white/10 text-white/80 rounded-full border border-white/20">
  Label
</span>
```

### Icon Container
```jsx
<div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center">
  <Icon className="h-6 w-6 text-white/60" />
</div>
```

### Trading Side Badge (Buy)
```jsx
<span className="px-2 py-0.5 text-xs rounded bg-emerald-500/20 text-emerald-400/80 border border-emerald-500/30">
  BUY
</span>
```

### Trading Side Badge (Sell)
```jsx
<span className="px-2 py-0.5 text-xs rounded bg-rose-500/20 text-rose-400/80 border border-rose-500/30">
  SELL
</span>
```

---

## Accessibility

### Contrast Requirements
- Primary text on black: WCAG AAA (21:1)
- Secondary text (60% opacity): WCAG AA (7.2:1)
- Muted text (40% opacity): Use sparingly, not for critical info

### Interactive States
All interactive elements must have:
- Visible hover state
- Focus ring: `focus:ring-2 focus:ring-white/50 focus:outline-none`
- Clear active state

### Color Independence
Never rely on color alone to convey information. Always pair with:
- Icons (TrendingUp/TrendingDown)
- Text labels (BUY/SELL)
- Position indicators

---

## Do's and Don'ts

### Do
- Use `bg-black` for page backgrounds
- Use light font weights for headings
- Use subtle emerald/rose accents for trading UI
- Rely on icons + text for price direction
- Maintain high contrast for critical information

### Don't
- Use saturated green/red (`green-500`, `red-500`)
- Use colored backgrounds for non-trading elements
- Mix font weights inconsistently
- Use gradients (except in hero section blur effects)
- Use shadows heavier than `shadow-lg`

---

## Quick Reference

```
// Backgrounds
bg-black, bg-white/5, bg-white/10

// Text
text-white, text-white/60, text-white/50, text-white/40

// Borders
border-white/10, border-white/20, border-white/30

// Trading (Buy)
bg-emerald-500/20, text-emerald-400/80, border-emerald-500/30

// Trading (Sell)
bg-rose-500/20, text-rose-400/80, border-rose-500/30

// Typography
font-light, font-normal, font-medium

// Radius
rounded-lg, rounded-xl, rounded-full
```
