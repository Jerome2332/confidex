# Confidex - Remaining Tasks

**Last Updated:** January 15, 2026
**Submission Deadline:** January 30, 2026
**Days Remaining:** 15

---

## Priority Legend
- 🔴 **Critical** - Must complete for submission
- 🟡 **Important** - Significantly improves submission
- 🟢 **Nice to Have** - Stretch goals

---

## 1. Deployment Tasks 🔴

### 1.1 Deploy Solana Programs
- [x] Deploy `confidex_dex` to devnet ✅ COMPLETED
  - Program ID: `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB`
  - Size: 375KB
- [x] Deploy `arcium_mxe` to devnet ✅ COMPLETED
  - Program ID: `CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE`
  - Size: 239KB
- [ ] Deploy ZK verifier via Sunspot ⏳ PARTIAL
  - Circuit compiled: `circuits/eligibility/target/eligibility.json` (32KB)
  - Noir tests: 2/2 passing
  - **Blocker:** Sunspot CLI not installed (needed for Solana verifier deployment)
  - Command: `sunspot compile && sunspot setup && sunspot deploy`

### 1.2 Host Frontend
- [ ] Deploy frontend to Vercel
  - Connect GitHub repo
  - Set environment variables:
    - `NEXT_PUBLIC_PROGRAM_ID`
    - `NEXT_PUBLIC_MXE_PROGRAM_ID`
    - `NEXT_PUBLIC_RPC_URL`
    - `NEXT_PUBLIC_HELIUS_API_KEY`
    - `NEXT_PUBLIC_PROOF_SERVER_URL`
- [ ] Test live deployment with wallet connection

---

## 2. Documentation Updates 🟡

### 2.1 PRD Synchronization
- [ ] **PRD-003**: Update Barretenberg → Sunspot/Groth16
  - Location: `docs/PRD-003-*.md`
  - Change: Client-side proving references to server-side
- [ ] **PRD-001**: Update timeline and prize targets
  - Current: $33K target
  - Update to: $66.5K target
- [ ] **PRD-002**: Add dual settlement account structures
  - Add C-SPL + ShadowWire settlement options
- [ ] **PRD-005**: Add ShadowWire/Inco/PNP integration specs
  - Document actual SDK patterns used
- [ ] **dev-setup.md**: Align version numbers
  - Anchor: 0.32.1
  - Rust: 1.89.0
  - Noir: 1.0.0-beta.13

---

## 3. Missing Tests 🟡

### 3.1 Integration Tests
- [x] Create `tests/integration/mpc_matching.ts` ✅ COMPLETED
  - Test encrypted price comparison
  - Test fill amount calculation
  - Test callback handling
  - Add to `package.json` scripts
  - **Result:** 10/10 tests passing

---

## 4. Demo & Submission 🔴

### 4.1 Demo Video (3 minutes)
- [ ] Record demo video
  - **0:00-0:30** - Problem: MEV, front-running, no privacy in DeFi
  - **0:30-1:00** - Solution: Confidex three-layer architecture
  - **1:00-2:00** - Live Demo: Place order, show encryption, match, settle
  - **2:00-2:30** - Technical: Arcium MPC + Noir ZK + ShadowWire
  - **2:30-3:00** - Why it matters: Institutional adoption, compliance

### 4.2 Submission Checklist
- [ ] Ensure GitHub repo is public
- [ ] Verify README has setup instructions
- [ ] Submit prize track declarations:
  - [ ] Arcium ($10K)
  - [ ] Aztec/Noir ($10K)
  - [ ] Open Track ($18K)
  - [ ] Helius ($5K)
  - [ ] Radr Labs ShadowWire ($15K)
  - [ ] PNP ($2.5K)

---

## 5. Frontend Enhancements 🟢

### 5.1 Missing Pages
- [x] Create Wrap/Unwrap page (`/wrap`) ✅ COMPLETED
  - Deposit tokens to get confidential tokens
  - Withdraw confidential tokens to regular tokens
  - Show balances before/after
  - **Features:** Tab switching, token selection, max amount, conversion preview

---

## 6. Stretch Goals 🟢

### 6.1 Inco Lightning Integration ($6K prize)
- [ ] Add Inco SDK dependency
- [ ] Create `frontend/src/lib/inco.ts`
- [ ] Implement TEE-based confidential operations
- [ ] Document as alternative to Arcium

---

## Progress Summary

| Category | Total | Completed | Remaining |
|----------|-------|-----------|-----------|
| Deployment | 4 | 2 | 2 |
| Documentation | 5 | 0 | 5 |
| Tests | 1 | 1 | 0 |
| Demo/Submission | 8 | 0 | 8 |
| Frontend | 1 | 1 | 0 |
| Stretch | 4 | 0 | 4 |
| **Total** | **23** | **4** | **19** |

---

## Completed Phases ✅

- [x] Phase 0: Environment Setup
- [x] Phase 1: Core Smart Contracts (`confidex_dex`)
- [x] Phase 2: ZK Circuit + Verifier (Noir circuit, proof server)
- [x] Phase 3: Arcium MPC Integration (`arcium_mxe`)
- [x] Phase 4: Settlement Integrations (ShadowWire)
- [x] Phase 5: Frontend Development (Next.js app)
- [x] Phase 6: Prize Integrations (Helius, PNP)
- [x] Phase 7: Testing + Demo Prep (integration tests, demo script)

---

## Quick Commands

```bash
# Build programs
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Run frontend locally
cd frontend && pnpm dev

# Run tests
cd tests && pnpm test

# Run demo
./scripts/demo.sh
```

---

## Notes

- Programs compile successfully: `confidex_dex.so` (368KB), `arcium_mxe.so` (236KB)
- Frontend builds successfully
- All 29 integration tests pass (ZK: 10, Trade: 9, MPC: 10)
- Helius RPC integration requires API key in `.env.local`
