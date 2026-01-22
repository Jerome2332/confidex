# Audio Files Required

Add the following audio files to enable sound in the HeroVideo composition.

## Background Music

| File | Description | Recommended |
|------|-------------|-------------|
| `background-music.mp3` | Ambient electronic/tech track, ~60-65 seconds | Low-key, modern, cinematic |

## Sound Effects (in `/sfx/` folder)

| File | Trigger | Description |
|------|---------|-------------|
| `logo-reveal.mp3` | Logo appears (IntroScene) | Subtle whoosh or shimmer, ~0.5-1s |
| `whoosh.mp3` | Scene transitions, CTA reveal | Soft swoosh sound, ~0.3-0.5s |
| `click.mp3` | Button click (DemoScene) | UI click/tap sound, ~0.1-0.2s |
| `success.mp3` | Completions, badge pop, toast | Positive chime/ding, ~0.5-1s |
| `data-process.mp3` | Data encryption animations | Digital/glitch sound, ~1-2s |
| `lock.mp3` | ZK verification, secure actions | Lock click or secure sound, ~0.3-0.5s |
| `match-found.mp3` | MPC match found (Layer2Scene) | Notification ping, ~0.5s |

## Volume Levels

All volumes are configurable in `HeroVideo.tsx`:

```typescript
const SFX_CONFIG = {
  whoosh: { volume: 0.5 },
  logoReveal: { volume: 0.6 },
  click: { volume: 0.4 },
  success: { volume: 0.5 },
  dataProcess: { volume: 0.3 },
  lock: { volume: 0.4 },
  matchFound: { volume: 0.5 },
};
```

## Recommended Sources

- **Freesound.org** - Free CC-licensed sounds
- **Mixkit.co** - Free sound effects
- **Uppbeat.io** - Royalty-free music and SFX

## Tips

1. Keep all SFX short (under 2 seconds)
2. Use consistent audio levels across files
3. Export as MP3 at 128-192kbps for web
4. Test with background music to ensure SFX aren't too loud
