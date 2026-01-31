'use client';

import { FC, useState } from 'react';
import { Header } from '@/components/header';
import { DataFlowDiagram } from '@/components/data-flow-diagram';
import {
  Shield,
  Stack as StackIcon,
  FingerprintSimple as FingerprintIcon,
  Cpu as CpuIcon,
  HardDrives as HardDrivesIcon,
  GitBranch as GitBranchIcon,
  ShieldChevron as ShieldChevronIcon,
  Code as CodeIcon,
  Eye,
  EyeSlash,
  CheckCircle,
  ArrowSquareOut,
  CaretDown,
  CaretRight,
  Lightning,
  Chats,
  Database,
  Pulse,
  ChartLineUp,
  Rocket,
  Clock,
} from '@phosphor-icons/react';
import Image from 'next/image';

type SectionId = 'overview' | 'architecture' | 'zk-layer' | 'mpc-layer' | 'settlement' | 'flow' | 'security' | 'production' | 'programs' | 'faq' | 'roadmap';

interface NavItem {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: <Shield size={16} /> },
  { id: 'architecture', label: 'Privacy Architecture', icon: <StackIcon size={16} /> },
  { id: 'zk-layer', label: 'ZK Compliance', icon: <FingerprintIcon size={16} /> },
  { id: 'mpc-layer', label: 'MPC Execution', icon: <CpuIcon size={16} /> },
  { id: 'settlement', label: 'Settlement', icon: <HardDrivesIcon size={16} /> },
  { id: 'flow', label: 'Data Flow', icon: <GitBranchIcon size={16} /> },
  { id: 'security', label: 'Security Model', icon: <ShieldChevronIcon size={16} /> },
  { id: 'production', label: 'Production Ready', icon: <Lightning size={16} /> },
  { id: 'programs', label: 'Programs & IDs', icon: <CodeIcon size={16} /> },
  { id: 'faq', label: 'FAQ', icon: <Chats size={16} /> },
  { id: 'roadmap', label: 'Future Implementations', icon: <Rocket size={16} /> },
];

const CodeBlock: FC<{ children: string }> = ({ children }) => (
  <pre className="bg-black border border-white/10 rounded-lg p-4 overflow-x-auto text-sm">
    <code className="text-white/80 font-mono">{children}</code>
  </pre>
);

const ExpandableSection: FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({
  title,
  children,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors"
      >
        <span className="font-medium text-white">{title}</span>
        {isOpen ? <CaretDown size={20} className="text-white/60" /> : <CaretRight size={20} className="text-white/60" />}
      </button>
      {isOpen && <div className="p-4 border-t border-white/10">{children}</div>}
    </div>
  );
};

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>('overview');

  const scrollToSection = (id: SectionId) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <main className="min-h-screen bg-black">
      <Header />

      <div className="flex">
        {/* Sidebar Navigation */}
        <aside className="hidden lg:block w-64 border-r border-white/10 sticky top-[61px] h-[calc(100vh-61px)] overflow-y-auto">
          <nav className="p-4 space-y-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeSection === item.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          <div className="p-4 border-t border-white/10">
            <div className="text-xs text-white/40 mb-2">External Resources</div>
            <div className="space-y-1">
              <a
                href="https://docs.arcium.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                Arcium Docs
                <ArrowSquareOut size={12} />
              </a>
              <a
                href="https://noir-lang.org/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                Noir Docs
                <ArrowSquareOut size={12} />
              </a>
              <a
                href="https://github.com/Radrdotfun/ShadowWire"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                ShadowWire
                <ArrowSquareOut size={12} />
              </a>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 max-w-4xl mx-auto px-6 py-12">
          {/* Overview Section */}
          <section id="overview" className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-white/10 rounded-lg">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-3xl font-light text-white">Confidex Technical Documentation</h1>
            </div>

            <p className="text-lg text-white/70 mb-8 leading-relaxed">
              Confidex is a confidential decentralized exchange implementing a <strong className="text-white">two-layer privacy architecture</strong> using
              Arcium MPC for encrypted order matching and ShadowWire for private settlement. All order data (price, quantity, side, trader identity)
              is encrypted on-chain and only decrypted within the MPC cluster for matching.
            </p>

            {/* Key Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Ciphertext Size', value: '32 bytes' },
                { label: 'Order Submit', value: '< 2s' },
                { label: 'MPC Callback', value: '30-60s' },
                { label: 'Encrypted Fields', value: '5 per order' },
              ].map((stat) => (
                <div key={stat.label} className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <div className="text-2xl font-mono text-white mb-1">{stat.value}</div>
                  <div className="text-xs text-white/50">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Prize Alignment */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <Lightning size={20} />
                Hackathon Prize Alignment
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex items-start gap-3">
                  <CheckCircle size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">Arcium</div>
                    <div className="text-white/50">MPC order matching with Cerberus protocol</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">Aztec/Noir</div>
                    <div className="text-white/50">Real ZK compliance verification</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">ShadowWire</div>
                    <div className="text-white/50">Bulletproof settlement integration</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">Open Track</div>
                    <div className="text-white/50">Two-layer privacy model (MPC + private settlement)</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Architecture Section */}
          <section id="architecture" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <StackIcon size={36} />
              Two-Layer Privacy Architecture
            </h2>

            <p className="text-white/70 mb-8">
              Confidex uses Arcium MPC as the primary privacy layer - all order data (price, quantity, side, trader identity) is encrypted
              on-chain. ShadowWire provides private settlement with hidden transfer amounts. ZK eligibility proofs are available as an optional
              compliance layer for regulated use cases.
            </p>

            {/* Layer Cards */}
            <div className="space-y-6">
              {/* Layer 1 */}
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="bg-white/5 px-6 py-4 border-b border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-mono text-white">
                      1
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-white">Compliance Layer (Noir ZK Proofs)</h3>
                      <p className="text-sm text-white/50">Prove eligibility without revealing identity</p>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-white/50 mb-1">Proof System</div>
                      <div className="text-white font-mono">Groth16 via Sunspot</div>
                    </div>
                    <div>
                      <div className="text-white/50 mb-1">Hash Function</div>
                      <div className="text-white font-mono">Poseidon2</div>
                    </div>
                    <div>
                      <div className="text-white/50 mb-1">Merkle Depth</div>
                      <div className="text-white font-mono">20 levels (~1M addresses)</div>
                    </div>
                  </div>
                  <p className="text-white/60 mt-4 text-sm">
                    Uses Sparse Merkle Tree non-membership proofs - proves you&apos;re NOT on the blacklist without revealing who IS blacklisted.
                  </p>
                </div>
              </div>

              {/* Layer 2 */}
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="bg-white/5 px-6 py-4 border-b border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-mono text-white">
                      2
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-white">Execution Layer (Arcium MPC)</h3>
                      <p className="text-sm text-white/50">Encrypted order matching preventing MEV</p>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-white/50 mb-1">Protocol</div>
                      <div className="text-white font-mono">Cerberus (Dishonest Majority)</div>
                    </div>
                    <div>
                      <div className="text-white/50 mb-1">Encryption</div>
                      <div className="text-white font-mono">RescueCipher + X25519</div>
                    </div>
                    <div>
                      <div className="text-white/50 mb-1">Security</div>
                      <div className="text-white font-mono">1-of-N honest guarantee</div>
                    </div>
                  </div>
                  <p className="text-white/60 mt-4 text-sm">
                    Order prices are encrypted before submission. MPC nodes compare encrypted prices without ever decrypting them - only the boolean match result is revealed.
                  </p>
                </div>
              </div>

              {/* Layer 3 */}
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="bg-white/5 px-6 py-4 border-b border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-mono text-white">
                      3
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-white">Settlement Layer (ShadowWire / C-SPL)</h3>
                      <p className="text-sm text-white/50">Private token transfers and encrypted balances</p>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-white/50 mb-1">Primary</div>
                      <div className="text-white font-mono">ShadowWire (Bulletproofs)</div>
                    </div>
                    <div>
                      <div className="text-white/50 mb-1">Future</div>
                      <div className="text-white font-mono">C-SPL (ElGamal)</div>
                    </div>
                    <div>
                      <div className="text-white/50 mb-1">Fallback</div>
                      <div className="text-white font-mono">Standard SPL</div>
                    </div>
                  </div>
                  <p className="text-white/60 mt-4 text-sm">
                    ShadowWire enables private transfers where amounts are hidden via Bulletproof range proofs. C-SPL will provide fully encrypted on-chain balances.
                  </p>
                </div>
              </div>
            </div>

            {/* Infrastructure Note */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mt-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <HardDrivesIcon size={20} className="text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-medium text-white">Light Protocol (Infrastructure)</h4>
                    <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">Cost Optimization</span>
                  </div>
                  <p className="text-sm text-white/60 mb-3">
                    Light Protocol provides ZK Compression for rent-free token accounts, reducing storage costs by ~400x compared to regular SPL accounts.
                    This is an <strong className="text-white">infrastructure optimization</strong>, not a privacy layer - amounts remain visible on-chain.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-white/50 mb-1">Privacy Level</div>
                      <div className="text-yellow-400 font-mono">Partial (amounts visible)</div>
                    </div>
                    <div>
                      <div className="text-white/50 mb-1">Cost Savings</div>
                      <div className="text-white font-mono">~400x cheaper storage</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ZK Layer Section */}
          <section id="zk-layer" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <FingerprintIcon size={36} />
              ZK Compliance Layer
            </h2>

            <p className="text-white/70 mb-6">
              The eligibility circuit proves blacklist non-membership without revealing the user&apos;s address. This enables
              regulatory compliance (KYC/AML screening) while preserving user privacy.
            </p>

            <ExpandableSection title="Circuit Specification" defaultOpen>
              <CodeBlock>{`// circuits/eligibility/src/main.nr
fn main(
    // Public input - stored on-chain
    blacklist_root: pub Field,

    // Private inputs - never revealed
    merkle_path: [Field; 20],
    path_indices: [Field; 20]
) {
    // Verify SMT non-membership by checking path leads to empty leaf
    // The address is derived from path_indices, never passed directly
    let valid = verify_smt_non_membership(
        blacklist_root,
        merkle_path,
        path_indices
    );

    assert(valid, "Address is blacklisted or proof invalid");
    // Proof passes = address NOT on blacklist
}`}</CodeBlock>
            </ExpandableSection>

            <div className="mt-6">
              <ExpandableSection title="Proof Generation Flow">
                <ol className="space-y-3 text-sm text-white/70">
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs text-white flex-shrink-0">1</span>
                    <span>Frontend signs message proving wallet ownership</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs text-white flex-shrink-0">2</span>
                    <span>Backend verifies signature and fetches blacklist root from on-chain</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs text-white flex-shrink-0">3</span>
                    <span>Backend queries merkle proof from blacklist indexer</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs text-white flex-shrink-0">4</span>
                    <span>Backend runs Sunspot CLI to generate Groth16 proof (~388 bytes)</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs text-white flex-shrink-0">5</span>
                    <span>On-chain verifier validates proof during order placement</span>
                  </li>
                </ol>
              </ExpandableSection>
            </div>

            {/* ZK Infrastructure Status */}
            <div className="mt-8 bg-white/5 border border-white/10 rounded-xl p-6">
              <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <CodeIcon size={20} />
                ZK Infrastructure Status
              </h3>
              <p className="text-sm text-white/60 mb-4">
                The complete ZK proving infrastructure is built, tested, and operational. The backend service generates real Groth16 proofs
                using the following components:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-black/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={16} className="text-emerald-400" />
                    <span className="text-white font-medium text-sm">Noir Circuit</span>
                  </div>
                  <div className="text-xs text-white/50 font-mono">v1.0.0-beta.13</div>
                  <p className="text-xs text-white/60 mt-1">Eligibility verification circuit with Poseidon2 hash and SMT depth 20</p>
                </div>
                <div className="bg-black/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={16} className="text-emerald-400" />
                    <span className="text-white font-medium text-sm">Sunspot Prover</span>
                  </div>
                  <div className="text-xs text-white/50 font-mono">gnark v0.14.0 (Groth16)</div>
                  <p className="text-xs text-white/60 mt-1">Generates Solana-compatible Groth16 proofs in 3-5 seconds</p>
                </div>
                <div className="bg-black/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={16} className="text-emerald-400" />
                    <span className="text-white font-medium text-sm">On-Chain Verifier</span>
                  </div>
                  <div className="text-xs text-white/50 font-mono">9op573D8GuuMAL2...tSNi</div>
                  <p className="text-xs text-white/60 mt-1">Deployed verifier program validates proofs during order placement</p>
                </div>
                <div className="bg-black/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={16} className="text-emerald-400" />
                    <span className="text-white font-medium text-sm">Circuit Artifacts</span>
                  </div>
                  <div className="text-xs text-white/50 font-mono">pk: 1.9MB, vk: 716B</div>
                  <p className="text-xs text-white/60 mt-1">Proving/verification keys and compiled constraint system ready</p>
                </div>
              </div>
              <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <div className="flex items-start gap-2 text-sm">
                  <CheckCircle size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span className="text-emerald-400/80">
                    ZK proofs are <strong className="text-emerald-400">enabled</strong> and fully operational. The backend prover generates real Groth16 proofs
                    using nargo + sunspot. Proofs are verified on-chain by the eligibility verifier program during order placement.
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* MPC Layer Section */}
          <section id="mpc-layer" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <CpuIcon size={36} />
              MPC Execution Layer
            </h2>

            <p className="text-white/70 mb-6">
              Arcium&apos;s Multi-Party Computation enables encrypted order matching. Prices and amounts are encrypted before submission -
              the MPC cluster compares them without ever decrypting, preventing front-running and MEV extraction.
            </p>

            {/* MXE Deployment Status */}
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 mb-6">
              <h3 className="font-medium text-white mb-4 flex items-center gap-2">
                <CheckCircle size={20} className="text-emerald-400" />
                MXE Deployment Status (Live)
              </h3>

              {/* Spot Trading MXE */}
              <div className="mb-4">
                <h4 className="text-white font-medium mb-2">Spot Trading MXE</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-white/50 mb-1">Program ID</div>
                    <code className="text-xs font-mono text-emerald-400">CJRUcrAFi764GHcPRg1e12Ymw7Nb2ZmrnFoW1k87XJMM</code>
                  </div>
                  <div>
                    <div className="text-white/50 mb-1">X25519 Public Key</div>
                    <code className="text-xs font-mono text-emerald-400 break-all">fe955746fa98e3597086eaca87eb248c33de439ad23549c7cdb87b16d3baed72</code>
                  </div>
                  <div>
                    <div className="text-white/50 mb-1">Circuits</div>
                    <a href="https://github.com/Jerome2332/confidex/releases/tag/v0.1.0-circuits" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 text-xs flex items-center gap-1">
                      v0.1.0-circuits (6 circuits)
                      <ArrowSquareOut size={12} />
                    </a>
                  </div>
                </div>
              </div>

              {/* Perpetuals MXE */}
              <div className="pt-4 border-t border-emerald-500/20">
                <h4 className="text-white font-medium mb-2">Perpetuals MXE</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-white/50 mb-1">Program ID</div>
                    <code className="text-xs font-mono text-emerald-400">CSTs9KjTmnwu3Wg76kE49Mgud2GyAQeQjZ66zicTQKq9</code>
                  </div>
                  <div>
                    <div className="text-white/50 mb-1">X25519 Public Key</div>
                    <code className="text-xs font-mono text-emerald-400 break-all">9163f8e9c1ac55ead26717a6985f09366c46e629d7f1024319ad5f428b4682bf</code>
                  </div>
                  <div>
                    <div className="text-white/50 mb-1">Circuits</div>
                    <a href="https://github.com/Jerome2332/confidex/releases/tag/v0.2.0-circuits" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 text-xs flex items-center gap-1">
                      v0.2.0-circuits (13 active circuits)
                      <ArrowSquareOut size={12} />
                    </a>
                  </div>
                </div>
              </div>

              {/* Common Info */}
              <div className="pt-4 mt-4 border-t border-emerald-500/20">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-white/50 mb-1">Cluster</div>
                    <div className="text-white font-mono">456 (Arcium v0.6.3 devnet)</div>
                  </div>
                  <div>
                    <div className="text-white/50 mb-1">Deployed</div>
                    <div className="text-white font-mono">January 30, 2026</div>
                  </div>
                </div>
              </div>
            </div>

            {/* MPC Operations Table */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-white/10 bg-white/5">
                <h3 className="font-medium text-white">Supported MPC Operations</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Operation</th>
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Inputs</th>
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Output</th>
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Use Case</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/70">
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3 font-mono text-white">ComparePrices</td>
                      <td className="px-6 py-3">2x encrypted u64</td>
                      <td className="px-6 py-3">bool</td>
                      <td className="px-6 py-3">Determine if orders match</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3 font-mono text-white">CalculateFill</td>
                      <td className="px-6 py-3">4x encrypted amounts</td>
                      <td className="px-6 py-3">encrypted + 2 bools</td>
                      <td className="px-6 py-3">Calculate fill amount</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3 font-mono text-white">VerifyPositionParams</td>
                      <td className="px-6 py-3">encrypted collateral/size</td>
                      <td className="px-6 py-3">bool</td>
                      <td className="px-6 py-3">Perps position opening</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3 font-mono text-white">BatchLiquidationCheck</td>
                      <td className="px-6 py-3">up to 10 encrypted thresholds + mark</td>
                      <td className="px-6 py-3">bool[10]</td>
                      <td className="px-6 py-3">V2: Batch liquidation check</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-3 font-mono text-white">CalculatePnL</td>
                      <td className="px-6 py-3">encrypted size/entry + price</td>
                      <td className="px-6 py-3">u64 + is_loss bool</td>
                      <td className="px-6 py-3">Close position / liquidation</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* V2 Privacy Improvements */}
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 mb-6">
              <h3 className="font-medium text-white mb-4 flex items-center gap-2">
                <ShieldChevronIcon size={20} className="text-emerald-400" />
                V2 Privacy Enhancements
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-emerald-400 font-medium mb-1">Encrypted Liquidation Thresholds</div>
                  <div className="text-white/60">Prevents entry price reverse-engineering. Previously public thresholds revealed entry via <code className="text-xs bg-white/10 px-1 rounded">entry ≈ threshold / 0.95</code></div>
                </div>
                <div>
                  <div className="text-emerald-400 font-medium mb-1">Hash-Based IDs</div>
                  <div className="text-white/60">Order/position IDs are now <code className="text-xs bg-white/10 px-1 rounded">[u8; 16]</code> hashes instead of sequential u64, preventing activity correlation</div>
                </div>
                <div>
                  <div className="text-emerald-400 font-medium mb-1">Coarse Timestamps</div>
                  <div className="text-white/60">Hour precision (<code className="text-xs bg-white/10 px-1 rounded">timestamp / 3600 * 3600</code>) reduces temporal correlation attacks</div>
                </div>
                <div>
                  <div className="text-emerald-400 font-medium mb-1">Minimal Order Status</div>
                  <div className="text-white/60">Only Active/Inactive states exposed (was 5 states). Internal <code className="text-xs bg-white/10 px-1 rounded">is_matching</code> flag for MPC tracking</div>
                </div>
              </div>
            </div>

            <ExpandableSection title="Encryption Implementation">
              <CodeBlock>{`// Frontend encryption using Arcium SDK
import { RescueCipher } from '@arcium-hq/client';
import { x25519 } from '@noble/curves/ed25519';

// Generate ephemeral keypair for this session
const privateKey = x25519.utils.randomSecretKey();
const publicKey = x25519.getPublicKey(privateKey);

// ECDH with MXE public key
const sharedSecret = x25519.getSharedSecret(
  privateKey,
  mxePublicKey
);

// Encrypt order values
const cipher = new RescueCipher(sharedSecret);
const encryptedPrice = cipher.encrypt(
  priceBytes,
  nonce++
);
const encryptedAmount = cipher.encrypt(
  amountBytes,
  nonce++
);`}</CodeBlock>
            </ExpandableSection>

            <div className="mt-6">
              <ExpandableSection title="Cerberus Security Model">
                <div className="space-y-4 text-sm text-white/70">
                  <p>
                    <strong className="text-white">Dishonest Majority Model:</strong> Privacy is guaranteed if at least 1 of N Arx nodes is honest.
                    Even if N-1 nodes collude, they cannot learn the encrypted values.
                  </p>
                  <p>
                    <strong className="text-white">MAC Authentication:</strong> Cryptographic message authentication codes verify computation integrity.
                    Malicious nodes are cryptographically detected.
                  </p>
                  <p>
                    <strong className="text-white">Constant-Time Operations:</strong> All MPC operations execute in constant time, preventing
                    timing-based side-channel attacks.
                  </p>
                  <p>
                    <strong className="text-white">Slashing Penalties:</strong> Misbehaving nodes face automatic stake reduction,
                    creating strong economic incentives for honest behavior.
                  </p>
                </div>
              </ExpandableSection>
            </div>
          </section>

          {/* Settlement Section */}
          <section id="settlement" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <HardDrivesIcon size={36} />
              Settlement Layer
            </h2>

            <p className="text-white/70 mb-6">
              Settlement executes the final token transfers after MPC matching completes. We support multiple settlement
              providers with automatic fallback for maximum reliability.
            </p>

            {/* Settlement Providers */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                  <h4 className="font-medium text-white">ShadowWire</h4>
                </div>
                <div className="text-xs text-white/50 mb-2">Primary - Live</div>
                <p className="text-sm text-white/60">
                  Bulletproof ZK proofs hide transfer amounts. 1% relayer fee. Supports 17+ tokens.
                </p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                  <h4 className="font-medium text-white">C-SPL</h4>
                </div>
                <div className="text-xs text-white/50 mb-2">Future - Q1 2026</div>
                <p className="text-sm text-white/60">
                  Twisted ElGamal encryption for fully encrypted on-chain balances with optional auditor access.
                </p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                  <h4 className="font-medium text-white">Standard SPL</h4>
                </div>
                <div className="text-xs text-white/50 mb-2">Active Fallback</div>
                <p className="text-sm text-white/60">
                  Currently used for perpetual collateral transfers. Amounts visible on-chain until C-SPL SDK available.
                </p>
              </div>
            </div>

            <ExpandableSection title="V2 Pure Ciphertext Format" defaultOpen>
              <p className="text-sm text-white/70 mb-4">
                V2 uses pure ciphertext with no plaintext prefix. All values are fully encrypted and only MPC can access them:
              </p>
              <CodeBlock>{`// 64-byte V2 pure ciphertext format
[nonce (16 bytes) | ciphertext (32 bytes) | ephemeral_pk (16 bytes)]

Bytes 0-15:  Nonce             → MPC decryption seed
Bytes 16-47: Ciphertext        → Fully encrypted value
Bytes 48-63: Ephemeral pubkey  → MPC key routing

// No plaintext prefix - complete privacy`}</CodeBlock>
              <p className="text-sm text-white/50 mt-4">
                MPC handles all comparisons and calculations. Order amounts, prices, and liquidation thresholds
                are never visible on-chain.
              </p>
            </ExpandableSection>
          </section>

          {/* Data Flow Section */}
          <section id="flow" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <GitBranchIcon size={36} />
              Complete Data Flow
            </h2>

            <p className="text-white/70 mb-6">
              From order placement to settlement, here&apos;s how data flows through the three privacy layers:
            </p>

            {/* Interactive Flow Diagram */}
            <DataFlowDiagram />
          </section>

          {/* Security Section */}
          <section id="security" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <ShieldChevronIcon size={36} />
              Security Model & Privacy Guarantees
            </h2>

            {/* Privacy Matrix */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-white/10 bg-white/5">
                <h3 className="font-medium text-white">Privacy Guarantees Matrix (V2)</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Data</th>
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Visibility</th>
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Mechanism</th>
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/70">
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3">User Identity</td>
                      <td className="px-6 py-3 flex items-center gap-2"><EyeSlash size={14} className="text-emerald-400" /> Private</td>
                      <td className="px-6 py-3">ZK eligibility proof</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Full Privacy</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3">Order Amounts/Prices</td>
                      <td className="px-6 py-3 flex items-center gap-2"><EyeSlash size={14} className="text-emerald-400" /> Private</td>
                      <td className="px-6 py-3">V2 pure ciphertext (64 bytes)</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Full Privacy</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3">Price Comparison</td>
                      <td className="px-6 py-3 flex items-center gap-2"><EyeSlash size={14} className="text-emerald-400" /> Private</td>
                      <td className="px-6 py-3">MPC Cerberus protocol</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Full Privacy</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3">Liquidation Thresholds</td>
                      <td className="px-6 py-3 flex items-center gap-2"><EyeSlash size={14} className="text-emerald-400" /> Private</td>
                      <td className="px-6 py-3">MPC batch verification</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Full Privacy</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3">Position/Order IDs</td>
                      <td className="px-6 py-3 flex items-center gap-2"><EyeSlash size={14} className="text-emerald-400" /> Private</td>
                      <td className="px-6 py-3">Hash-based (no sequential leak)</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Full Privacy</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3">Timestamps</td>
                      <td className="px-6 py-3 flex items-center gap-2"><EyeSlash size={14} className="text-emerald-400" /> Coarse</td>
                      <td className="px-6 py-3">Hour precision only</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Full Privacy</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3">Order Status</td>
                      <td className="px-6 py-3 flex items-center gap-2"><EyeSlash size={14} className="text-emerald-400" /> Minimal</td>
                      <td className="px-6 py-3">Active/Inactive only (2 states)</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Full Privacy</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3">Position Side/Leverage</td>
                      <td className="px-6 py-3 flex items-center gap-2"><Eye size={14} className="text-yellow-400" /> Public</td>
                      <td className="px-6 py-3">Required for funding/risk</td>
                      <td className="px-6 py-3"><span className="text-yellow-400">Necessary</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3">Collateral Amount</td>
                      <td className="px-6 py-3 flex items-center gap-2"><Eye size={14} className="text-yellow-400" /> Public*</td>
                      <td className="px-6 py-3">SPL token transfer (C-SPL pending)</td>
                      <td className="px-6 py-3"><span className="text-yellow-400">Temporary</span></td>
                    </tr>
                    <tr>
                      <td className="px-6 py-3">Settlement</td>
                      <td className="px-6 py-3 flex items-center gap-2"><EyeSlash size={14} className="text-emerald-400" /> Private</td>
                      <td className="px-6 py-3">ShadowWire Bulletproofs</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Full Privacy</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="px-6 py-3 bg-white/5 text-xs text-white/50">
                V2 pure ciphertext format: [nonce (16) | ciphertext (32) | ephemeral_pk (16)] — no plaintext prefix<br />
                *Collateral uses standard SPL transfer as temporary fallback until C-SPL SDK is available
              </div>
            </div>

            {/* Threat Mitigations */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/10 bg-white/5">
                <h3 className="font-medium text-white">Threat Mitigations</h3>
              </div>
              <div className="p-4 space-y-4 text-sm">
                <div className="flex items-start gap-3">
                  <CheckCircle size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">Front-running Prevention</div>
                    <div className="text-white/50">Order prices encrypted via MPC - validators cannot see prices in mempool</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">MEV Extraction Prevention</div>
                    <div className="text-white/50">Match results unpredictable until MPC computation completes</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">Wallet Tracking Prevention</div>
                    <div className="text-white/50">User address never revealed - only ZK proof of eligibility</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">MPC Collusion Prevention</div>
                    <div className="text-white/50">Cerberus 1-of-N honest model - privacy guaranteed if any single node is honest</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Production Readiness Section */}
          <section id="production" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <Lightning size={36} />
              Production Readiness
            </h2>

            <p className="text-white/70 mb-6">
              Confidex is production-ready for hackathon demo with real token movements, persistent settlement tracking,
              and live order book data from the chain.
            </p>

            {/* Production Status Banner */}
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 mb-6">
              <h3 className="font-medium text-white mb-4 flex items-center gap-2">
                <CheckCircle size={20} className="text-emerald-400" />
                Production Features (January 2026)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex items-start gap-3">
                  <Database size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">SQLite Settlement Persistence</div>
                    <div className="text-white/50">Crank service survives restarts, no double-settlement possible</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <ChartLineUp size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">Real Order Book from Chain</div>
                    <div className="text-white/50">Fetches V5 orders, aggregates by price level, shows &quot;Live&quot; indicator</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Pulse size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">Real-Time Trade Feed</div>
                    <div className="text-white/50">Subscribes to settlement logs for live trade updates</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CpuIcon size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-white font-medium">MPC Event Callbacks</div>
                    <div className="text-white/50">Frontend receives MPC results via log subscription</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Key Hooks Table */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-white/10 bg-white/5">
                <h3 className="font-medium text-white">Frontend Hooks</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Hook</th>
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Purpose</th>
                      <th className="px-6 py-3 text-left text-white/50 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/70">
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3 font-mono text-white">useOrderBook()</td>
                      <td className="px-6 py-3">Real-time order book from chain (V5 orders)</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Live</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3 font-mono text-white">useRecentTrades()</td>
                      <td className="px-6 py-3">Live trade feed from settlement events</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Live</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3 font-mono text-white">useMpcEvents()</td>
                      <td className="px-6 py-3">MPC computation tracking and callbacks</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Live</span></td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-6 py-3 font-mono text-white">useEncryption()</td>
                      <td className="px-6 py-3">Client-side RescueCipher encryption</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Live</span></td>
                    </tr>
                    <tr>
                      <td className="px-6 py-3 font-mono text-white">useSolPrice()</td>
                      <td className="px-6 py-3">Pyth oracle price feed</td>
                      <td className="px-6 py-3"><span className="text-emerald-400">Live</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Crank Service Configuration */}
            <ExpandableSection title="Crank Service Configuration" defaultOpen>
              <p className="text-sm text-white/70 mb-4">
                The automated crank service provides production-grade order matching with SQLite persistence:
              </p>
              <CodeBlock>{`# Enable crank service
CRANK_ENABLED=true

# Production MPC (default is TRUE as of Jan 2026)
CRANK_USE_REAL_MPC=true

# Configuration
CRANK_POLLING_INTERVAL_MS=5000    # Check for matches every 5s
CRANK_USE_ASYNC_MPC=true          # Production async MPC flow
CRANK_MAX_CONCURRENT_MATCHES=5    # Parallel match attempts
CRANK_DB_PATH=./data/crank.db        # SQLite persistence

# Check crank status
curl http://localhost:3001/admin/crank/status`}</CodeBlock>
            </ExpandableSection>

            <div className="mt-6">
              <ExpandableSection title="API Endpoints">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="px-4 py-2 text-left text-white/50 font-medium">Endpoint</th>
                        <th className="px-4 py-2 text-left text-white/50 font-medium">Method</th>
                        <th className="px-4 py-2 text-left text-white/50 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-white/70">
                      <tr className="border-b border-white/5">
                        <td className="px-4 py-2 font-mono text-white">/health</td>
                        <td className="px-4 py-2">GET</td>
                        <td className="px-4 py-2">Health check with prover status</td>
                      </tr>
                      <tr className="border-b border-white/5">
                        <td className="px-4 py-2 font-mono text-white">/api/prove</td>
                        <td className="px-4 py-2">POST</td>
                        <td className="px-4 py-2">Generate ZK eligibility proof</td>
                      </tr>
                      <tr className="border-b border-white/5">
                        <td className="px-4 py-2 font-mono text-white">/admin/crank/status</td>
                        <td className="px-4 py-2">GET</td>
                        <td className="px-4 py-2">Crank metrics and status</td>
                      </tr>
                      <tr className="border-b border-white/5">
                        <td className="px-4 py-2 font-mono text-white">/admin/crank/start</td>
                        <td className="px-4 py-2">POST</td>
                        <td className="px-4 py-2">Start crank service</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2 font-mono text-white">/admin/crank/stop</td>
                        <td className="px-4 py-2">POST</td>
                        <td className="px-4 py-2">Stop crank service</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </ExpandableSection>
            </div>
          </section>

          {/* Programs Section */}
          <section id="programs" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <CodeIcon size={36} />
              Program IDs & Accounts
            </h2>

            {/* Program IDs */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-white/10 bg-white/5">
                <h3 className="font-medium text-white">Devnet Program IDs</h3>
              </div>
              <div className="divide-y divide-white/5">
                {[
                  { name: 'Confidex DEX', id: '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB', desc: 'Core DEX logic, order management' },
                  { name: 'Spot Trading MXE', id: 'CJRUcrAFi764GHcPRg1e12Ymw7Nb2ZmrnFoW1k87XJMM', desc: 'MPC for spot order matching' },
                  { name: 'Perpetuals MXE', id: 'CSTs9KjTmnwu3Wg76kE49Mgud2GyAQeQjZ66zicTQKq9', desc: 'MPC for perps positions' },
                  { name: 'Eligibility Verifier', id: '9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W', desc: 'Groth16 proof verification' },
                  { name: 'Arcium Core', id: 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ', desc: 'Official Arcium program' },
                ].map((program) => (
                  <div key={program.id} className="px-6 py-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-white font-medium">{program.name}</span>
                      <span className="text-xs text-white/40">{program.desc}</span>
                    </div>
                    <code className="text-sm font-mono text-white/60 break-all">{program.id}</code>
                  </div>
                ))}
              </div>
            </div>

            {/* Deployment Status */}
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 mb-6">
              <h3 className="font-medium text-white mb-4 flex items-center gap-2">
                <CheckCircle size={20} className="text-emerald-400" />
                Latest Deployment (January 2026)
              </h3>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-white/50 mb-1">Deployment Transaction</div>
                  <a
                    href="https://explorer.solana.com/tx/5R4vHzBEsVkJBQZLMEBp9aRamZjEpvsbtwyEVGZhF2JvdcRGXWFWMqCdLPJkqxZuckBJr1Voa3Mcnh1WaBXC547p?cluster=devnet"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 font-mono text-xs break-all flex items-center gap-1"
                  >
                    5R4vHzBE...WaBXC547p
                    <ArrowSquareOut size={12} />
                  </a>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <div className="text-emerald-400 font-medium mb-1">V2 Features Live</div>
                    <ul className="text-white/60 text-xs space-y-1">
                      <li>• Encrypted liquidation thresholds</li>
                      <li>• Hash-based position IDs</li>
                      <li>• Coarse timestamps (hour precision)</li>
                      <li>• SPL collateral transfer (C-SPL pending)</li>
                    </ul>
                  </div>
                  <div>
                    <div className="text-yellow-400 font-medium mb-1">Pending C-SPL</div>
                    <ul className="text-white/60 text-xs space-y-1">
                      <li>• Collateral amounts currently visible</li>
                      <li>• Will use confidential_transfer when available</li>
                      <li>• Encrypted collateral blob stored for future use</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Account Structures */}
            <ExpandableSection title="Key Account Structures (Current)">
              <div className="space-y-4">
                <div>
                  <div className="text-white font-medium mb-2">ConfidentialOrder (V5 - 366 bytes)</div>
                  <CodeBlock>{`pub struct ConfidentialOrder {
    pub maker: Pubkey,              // Order creator
    pub pair: Pubkey,               // Trading pair
    pub side: Side,                 // Buy or Sell
    pub order_type: OrderType,      // Limit or Market
    pub encrypted_amount: [u8; 64], // Pure ciphertext
    pub encrypted_price: [u8; 64],  // Pure ciphertext
    pub encrypted_filled: [u8; 64], // Fill tracking
    pub status: OrderStatus,        // Active|Inactive (2 states)
    pub created_at_hour: i64,       // Coarse timestamp (hour)
    pub order_id: [u8; 16],         // Hash-based (no sequential leak)
    pub order_nonce: [u8; 8],       // For PDA derivation
    pub eligibility_proof_verified: bool,
    pub pending_match_request: [u8; 32],
    pub is_matching: bool,          // Internal matching flag
    pub bump: u8,
    pub ephemeral_pubkey: [u8; 32], // For MPC decryption
}`}</CodeBlock>
                </div>
                <div>
                  <div className="text-white font-medium mb-2">ConfidentialPosition (V9 - 820 bytes)</div>
                  <CodeBlock>{`pub struct ConfidentialPosition {
    pub trader: Pubkey,
    pub market: Pubkey,
    pub position_id: [u8; 16],          // Hash-based ID
    pub created_at_hour: i64,           // Coarse timestamp
    pub side: PositionSide,             // Long/Short (public)
    pub leverage: u8,                   // 1-20x (public)
    pub encrypted_size: [u8; 64],       // Pure ciphertext
    pub encrypted_entry_price: [u8; 64],// Pure ciphertext
    pub encrypted_collateral: [u8; 64], // Pure ciphertext
    pub encrypted_realized_pnl: [u8; 64], // Accumulated PnL
    pub encrypted_liq_below: [u8; 64],  // Encrypted threshold
    pub encrypted_liq_above: [u8; 64],  // Encrypted threshold
    pub threshold_commitment: [u8; 32], // hash(entry, leverage, mm_bps)
    pub ephemeral_pubkey: [u8; 32],     // V8: For MPC decryption
    pub encrypted_leverage: [u8; 32],   // V9: MPC verification
    pub encrypted_mm_bps: [u8; 32],     // V9: MPC verification
    pub encrypted_is_long: [u8; 32],    // V9: MPC verification
    // ... plus status flags, async MPC tracking fields
}`}</CodeBlock>
                </div>
                <div>
                  <div className="text-white font-medium mb-2">PendingMatch (213 bytes)</div>
                  <CodeBlock>{`pub struct PendingMatch {
    pub request_id: [u8; 32],       // Arcium computation ID
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub compare_result: Option<bool>,
    pub fill_result: Option<[u8; 64]>,
    pub status: PendingMatchStatus, // AwaitingCompare|Matched
}`}</CodeBlock>
                </div>
              </div>
            </ExpandableSection>
          </section>

          {/* FAQ Section */}
          <section id="faq" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <Chats size={36} />
              Frequently Asked Questions
            </h2>

            <p className="text-white/70 mb-6">
              Common questions about wallet warnings, privacy features, and trading on Confidex.
            </p>

            <div className="space-y-3">
              {/* Wallet Warning FAQ */}
              <ExpandableSection title='Why does my wallet show "Transaction reverted during simulation"?' defaultOpen>
                <div className="space-y-3 text-sm text-white/70">
                  <p>
                    This warning is <strong className="text-white">expected</strong> for Confidex transactions and does not mean your transaction will fail.
                  </p>
                  <p>
                    Confidex uses Arcium MPC (Multi-Party Computation) for encrypted order matching.
                    MPC operations require actual network execution and cannot be simulated locally by your wallet.
                  </p>
                  <p className="text-emerald-400/80">
                    Your transaction will succeed when submitted to the network.
                  </p>
                </div>
              </ExpandableSection>

              {/* Unknown Program FAQ */}
              <ExpandableSection title='Why does my wallet show "Unknown" for program instructions?'>
                <div className="space-y-3 text-sm text-white/70">
                  <p>
                    Wallets like Phantom and Solflare need an IDL (Interface Definition Language) to decode
                    transaction instructions into human-readable format.
                  </p>
                  <p>
                    Since Confidex is a custom program, wallets display raw data instead of parsed instructions.
                    This is normal for any new Solana program that wallets haven&apos;t integrated yet.
                  </p>
                </div>
              </ExpandableSection>

              {/* Hidden Amounts FAQ */}
              <ExpandableSection title="Why can't I see the amounts in my wallet confirmation?">
                <div className="space-y-3 text-sm text-white/70">
                  <p>
                    <strong className="text-white">This is privacy working as intended.</strong>
                  </p>
                  <p>
                    Your order amounts, prices, and position sizes are encrypted as 64-byte ciphertext blobs
                    using Arcium MPC encryption. Not even your wallet can decrypt these values.
                  </p>
                  <p>
                    Only you can see your actual position values in the Confidex UI after decryption with your keys.
                  </p>
                </div>
              </ExpandableSection>

              {/* Encrypted vs Public FAQ */}
              <ExpandableSection title="What data is encrypted vs public in my positions?">
                <div className="space-y-3 text-sm text-white/70">
                  <p><strong className="text-white">Encrypted (Private):</strong></p>
                  <ul className="list-disc list-inside ml-2 text-white/60">
                    <li>Position size</li>
                    <li>Entry price</li>
                    <li>Collateral amount</li>
                    <li>Liquidation thresholds</li>
                    <li>Realized PnL</li>
                  </ul>
                  <p className="mt-2"><strong className="text-white">Public (Required for protocol):</strong></p>
                  <ul className="list-disc list-inside ml-2 text-white/60">
                    <li>Position side (Long/Short) - needed for funding direction</li>
                    <li>Leverage - needed for risk management</li>
                    <li>Market - needed for routing</li>
                    <li>Your wallet address - inherent to blockchain</li>
                  </ul>
                </div>
              </ExpandableSection>

              {/* Verify Transaction FAQ */}
              <ExpandableSection title="How can I verify my transaction succeeded?">
                <div className="space-y-3 text-sm text-white/70">
                  <p>
                    After confirming the transaction in your wallet:
                  </p>
                  <ol className="list-decimal list-inside ml-2 space-y-1 text-white/60">
                    <li>Wait for the confirmation toast in Confidex</li>
                    <li>Check the Positions tab - your new position will appear</li>
                    <li>Click the transaction signature to view on Solana Explorer</li>
                    <li>On Explorer, you&apos;ll see the SPL token transfer for collateral</li>
                  </ol>
                </div>
              </ExpandableSection>

              {/* MPC Latency FAQ */}
              <ExpandableSection title="Why do some operations take a few seconds?">
                <div className="space-y-3 text-sm text-white/70">
                  <p>
                    Confidex uses MPC (Multi-Party Computation) for encrypted operations like:
                  </p>
                  <ul className="list-disc list-inside ml-2 text-white/60">
                    <li>Price comparisons for order matching</li>
                    <li>PnL calculations on close</li>
                    <li>Liquidation eligibility checks</li>
                  </ul>
                  <p className="mt-2">
                    MPC operations take ~500ms as they require coordination between multiple nodes
                    in the Arcium network. This is the cost of true privacy - no single party
                    ever sees your plaintext values.
                  </p>
                </div>
              </ExpandableSection>

              {/* Collateral Visibility FAQ */}
              <ExpandableSection title="Why is my collateral amount visible on Explorer?">
                <div className="space-y-3 text-sm text-white/70">
                  <p>
                    Currently, collateral transfers use standard SPL tokens as a fallback while
                    the C-SPL (Confidential SPL) SDK is being finalized.
                  </p>
                  <p>
                    This means the collateral transfer amount is visible on-chain, but your
                    position size, entry price, and liquidation thresholds remain fully encrypted.
                  </p>
                  <p className="text-amber-400/80">
                    Full collateral privacy will be enabled when C-SPL launches on devnet (Q1 2026).
                  </p>
                </div>
              </ExpandableSection>

              {/* Eligibility Proof FAQ */}
              <ExpandableSection title="What is the eligibility proof?">
                <div className="space-y-3 text-sm text-white/70">
                  <p>
                    Before trading, you generate a zero-knowledge (ZK) proof that proves you&apos;re
                    not on the exchange&apos;s blacklist - without revealing your identity.
                  </p>
                  <p>
                    This proof is generated client-side in ~2-3 seconds using Noir circuits and
                    verified on-chain via Sunspot&apos;s Groth16 verifier.
                  </p>
                  <p className="text-white/50">
                    The proof only needs to be generated once per wallet address.
                  </p>
                </div>
              </ExpandableSection>
            </div>

            {/* Warning Note */}
            <div className="mt-6 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <div className="flex items-start gap-2 text-sm text-amber-400/80">
                <span className="shrink-0 mt-0.5">⚠</span>
                <p>
                  <strong>Note:</strong> Wallet warnings about &quot;simulation failed&quot; are expected
                  for privacy-preserving transactions. Your transactions will succeed when submitted.
                </p>
              </div>
            </div>
          </section>

          {/* Future Implementations Section */}
          <section id="roadmap" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <Rocket size={36} />
              Future Implementations
            </h2>

            <p className="text-white/70 mb-6">
              Confidex is continuously improving privacy coverage. These are planned enhancements that will
              further strengthen the privacy guarantees of the protocol.
            </p>

            {/* C-SPL Collateral - High Priority */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 mb-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Clock size={20} className="text-amber-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-medium text-white">Confidential Collateral for Perpetuals</h3>
                    <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">High Priority</span>
                  </div>
                  <p className="text-sm text-white/60 mb-4">
                    Currently, perpetuals collateral transfers use standard SPL tokens, meaning collateral amounts
                    are visible on-chain. This is a temporary fallback while the C-SPL (Confidential SPL) SDK
                    for Rust programs is being finalized.
                  </p>

                  <div className="bg-black/30 rounded-lg p-4 mb-4">
                    <div className="text-white/50 text-xs mb-2">Current Flow (Temporary)</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-400"></div>
                        <span className="text-white/70">Wallet Balance (Native USDC)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/40">→</span>
                        <span className="text-amber-400">SPL Transfer (visible amount)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/40">→</span>
                        <span className="text-white/70">Market Collateral Vault</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-black/30 rounded-lg p-4">
                    <div className="text-emerald-400/80 text-xs mb-2">Future Flow (With C-SPL)</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                        <span className="text-white/70">Trading Balance (Encrypted C-SPL)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/40">→</span>
                        <span className="text-emerald-400">Confidential Transfer (hidden amount)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/40">→</span>
                        <span className="text-white/70">Market Collateral Vault (encrypted)</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-white font-medium mb-1">What&apos;s Currently Exposed</div>
                      <ul className="text-white/50 text-xs space-y-1">
                        <li>• Collateral deposit amount (USDC)</li>
                        <li>• Collateral withdrawal amount (USDC)</li>
                        <li>• Margin add/remove amounts</li>
                      </ul>
                    </div>
                    <div>
                      <div className="text-emerald-400 font-medium mb-1">What Remains Private</div>
                      <ul className="text-white/50 text-xs space-y-1">
                        <li>• Position size (encrypted)</li>
                        <li>• Entry price (encrypted)</li>
                        <li>• Liquidation thresholds (encrypted)</li>
                        <li>• PnL calculations (MPC)</li>
                      </ul>
                    </div>
                  </div>

                  <div className="mt-4 p-3 bg-white/5 border border-white/10 rounded-lg">
                    <div className="flex items-start gap-2 text-xs text-white/60">
                      <CodeIcon size={14} className="flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-white/80">Technical Detail:</span> The C-SPL SDK currently only has JavaScript
                        bindings. Rust programs cannot yet call <code className="text-xs bg-white/10 px-1 rounded">confidential_transfer</code>.
                        Once the Rust SDK is available, perpetuals will use the same encrypted trading balance as spot trading.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Additional Future Items */}
            <div className="space-y-4">
              {/* Multi-Asset Perpetuals */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                    <ChartLineUp size={16} className="text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-white">Multi-Asset Perpetuals</h4>
                      <span className="text-xs bg-white/10 text-white/50 px-2 py-0.5 rounded-full">Planned</span>
                    </div>
                    <p className="text-sm text-white/60">
                      Support for additional perpetual markets beyond SOL-PERP, including BTC-PERP, ETH-PERP,
                      and other major assets with encrypted position management.
                    </p>
                  </div>
                </div>
              </div>

              {/* Cross-Margin Mode */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                    <StackIcon size={16} className="text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-white">Cross-Margin with MPC</h4>
                      <span className="text-xs bg-white/10 text-white/50 px-2 py-0.5 rounded-full">Planned</span>
                    </div>
                    <p className="text-sm text-white/60">
                      Cross-margin mode where multiple positions share collateral. MPC will handle
                      encrypted aggregate margin calculations without revealing individual position details.
                    </p>
                  </div>
                </div>
              </div>

              {/* Batch Liquidation Optimization */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                    <CpuIcon size={16} className="text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-white">Batch Liquidation Optimization</h4>
                      <span className="text-xs bg-white/10 text-white/50 px-2 py-0.5 rounded-full">In Progress</span>
                    </div>
                    <p className="text-sm text-white/60">
                      The <code className="text-xs bg-white/10 px-1 rounded">batch_liquidation_check</code> circuit is
                      currently disabled due to high ACU cost (~4.2B per position). Working on optimizing the circuit
                      to enable efficient batch checking of up to 10 positions per MPC call.
                    </p>
                  </div>
                </div>
              </div>

              {/* Private Trade History */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                    <EyeSlash size={16} className="text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-white">Private Trade History</h4>
                      <span className="text-xs bg-white/10 text-white/50 px-2 py-0.5 rounded-full">Planned</span>
                    </div>
                    <p className="text-sm text-white/60">
                      Encrypted trade history stored off-chain with client-side decryption. Users will be able
                      to view their complete trading history privately without exposing it on-chain.
                    </p>
                  </div>
                </div>
              </div>

              {/* Auditor Access */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                    <ShieldChevronIcon size={16} className="text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-white">Optional Auditor Access</h4>
                      <span className="text-xs bg-white/10 text-white/50 px-2 py-0.5 rounded-full">Planned</span>
                    </div>
                    <p className="text-sm text-white/60">
                      Selective disclosure feature allowing users to grant read access to auditors or regulators
                      for specific positions. Uses re-encryption to share data without revealing master keys.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline Note */}
            <div className="mt-6 p-4 bg-white/5 border border-white/10 rounded-xl">
              <div className="flex items-start gap-3 text-sm">
                <Clock size={20} className="text-white/40 flex-shrink-0 mt-0.5" />
                <div className="text-white/60">
                  <strong className="text-white">Development Priority:</strong> C-SPL integration for perpetuals collateral
                  is the highest priority improvement. Timeline depends on the official Rust SDK release from Solana Labs.
                  Other features are planned for post-hackathon development cycles.
                </div>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="border-t border-white/10 pt-8 mt-16">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="text-sm text-white/40 font-light">
                Built for Solana Privacy Hack 2026
              </div>
              <div className="flex items-center gap-4 text-xs text-white/40 font-light">
                <span>Powered by</span>
                <a
                  href="https://arcium.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opacity-70 hover:opacity-100 transition-opacity"
                  title="Arcium MPC"
                >
                  <Image
                    src="/sponsors/arcium/Logos/02 Logomark/SVGs/Logomark 04.svg"
                    alt="Arcium"
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                </a>
                <a
                  href="https://aztec.network"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opacity-70 hover:opacity-100 transition-opacity"
                  title="Noir ZK (Aztec)"
                >
                  <Image
                    src="/sponsors/aztec/Aztec Symbol/svg/Aztec Symbol_Circle.svg"
                    alt="Aztec (Noir ZK)"
                    width={24}
                    height={24}
                  />
                </a>
                <a
                  href="https://lightprotocol.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opacity-70 hover:opacity-100 transition-opacity"
                  title="Light Protocol"
                >
                  <Image
                    src="/sponsors/light/logo.svg"
                    alt="Light Protocol"
                    width={24}
                    height={24}
                    className="rounded"
                  />
                </a>
                <a
                  href="https://triton.one"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opacity-70 hover:opacity-100 transition-opacity"
                  title="Triton"
                >
                  <Image
                    src="/sponsors/triton/Tron_LogoMark.svg"
                    alt="Triton"
                    width={28}
                    height={28}
                  />
                </a>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}
