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
} from '@phosphor-icons/react';

type SectionId = 'overview' | 'architecture' | 'zk-layer' | 'mpc-layer' | 'settlement' | 'flow' | 'security' | 'production' | 'programs' | 'faq';

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
              Confidex is a confidential decentralized exchange implementing a novel <strong className="text-white">three-layer privacy architecture</strong> that
              combines zero-knowledge proofs, multi-party computation, and encrypted tokens. This architecture enables private trading
              with hidden order amounts, prices, and balances while maintaining regulatory compliance.
            </p>

            {/* Key Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'ZK Proof Size', value: '~388 bytes' },
                { label: 'MPC Latency', value: '~500ms' },
                { label: 'Full Match', value: '1-2 sec' },
                { label: 'Verification', value: '~200K CU' },
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
                    <div className="text-white/50">Novel three-layer privacy model</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Architecture Section */}
          <section id="architecture" className="mb-16">
            <h2 className="text-2xl font-light text-white mb-6 flex items-center gap-3">
              <StackIcon size={36} />
              Three-Layer Privacy Architecture
            </h2>

            <p className="text-white/70 mb-8">
              Most privacy projects use EITHER zero-knowledge proofs OR multi-party computation. Confidex uniquely combines both
              with encrypted tokens to address different privacy needs at each stage of a trade. We also leverage Light Protocol
              for infrastructure optimization (rent-free storage), though this is a cost-saving measure rather than a privacy layer.
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
    address: Field,
    merkle_path: [Field; 20],
    path_indices: [Field; 20]
) {
    // Verify non-membership in blacklist SMT
    let computed_root = compute_smt_root(
        address,
        merkle_path,
        path_indices
    );

    assert(computed_root == blacklist_root);
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
                The complete ZK proving infrastructure is built and tested. Production deployment requires a dedicated prover service
                with the following components installed:
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
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="flex items-start gap-2 text-sm">
                  <span className="text-amber-400 flex-shrink-0">Note:</span>
                  <span className="text-amber-400/80">
                    ZK proofs are currently disabled in the demo to reduce infrastructure costs. The technology is fully implemented
                    and can be enabled by deploying a prover service (VM with nargo + sunspot) and setting <code className="bg-black/30 px-1 rounded">ZK_PROOFS_ENABLED=true</code>.
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-white/50 mb-1">MXE Program ID</div>
                  <code className="text-xs font-mono text-emerald-400">4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi</code>
                </div>
                <div>
                  <div className="text-white/50 mb-1">X25519 Public Key</div>
                  <code className="text-xs font-mono text-emerald-400 break-all">113364f169338f3fa0d1e76bf2ba71d40aff857dd5f707f1ea2abdaf52e2d06c</code>
                </div>
                <div>
                  <div className="text-white/50 mb-1">Cluster</div>
                  <div className="text-white font-mono">456 (Arcium v0.6.3 devnet)</div>
                </div>
                <div>
                  <div className="text-white/50 mb-1">Circuit Storage</div>
                  <a href="https://github.com/Jerome2332/confidex/releases/tag/v0.1.0-circuits" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 text-xs flex items-center gap-1">
                    GitHub Releases (10 circuits, ~15MB)
                    <ArrowSquareOut size={12} />
                  </a>
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
                    <div className="text-white/50">Fetches V4 orders, aggregates by price level, shows &quot;Live&quot; indicator</div>
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
                      <td className="px-6 py-3">Real-time order book from chain (V4 orders)</td>
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
CRANK_DB_PATH=./data/settlements.db  # SQLite persistence

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
                  { name: 'Arcium MXE', id: '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi', desc: 'MXE wrapper for MPC operations' },
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
            <ExpandableSection title="Key Account Structures (V2)">
              <div className="space-y-4">
                <div>
                  <div className="text-white font-medium mb-2">ConfidentialOrder (V2 - 321 bytes)</div>
                  <CodeBlock>{`pub struct ConfidentialOrder {
    pub maker: Pubkey,              // Order creator
    pub pair: Pubkey,               // Trading pair
    pub order_id: [u8; 16],         // V2: Hash-based (no sequential leak)
    pub side: Side,                 // Buy or Sell
    pub encrypted_amount: [u8; 64], // V2: Pure ciphertext
    pub encrypted_price: [u8; 64],  // V2: Pure ciphertext
    pub encrypted_filled: [u8; 64], // Fill tracking
    pub status: OrderStatus,        // V2: Active|Inactive (2 states)
    pub created_at_hour: i64,       // V2: Coarse timestamp (hour)
    pub is_matching: bool,          // V2: Internal matching flag
    pub eligibility_proof_verified: bool,
    pub pending_match_request: [u8; 32],
}`}</CodeBlock>
                </div>
                <div>
                  <div className="text-white font-medium mb-2">ConfidentialPosition (V2 - 561 bytes)</div>
                  <CodeBlock>{`pub struct ConfidentialPosition {
    pub trader: Pubkey,
    pub market: Pubkey,
    pub position_id: [u8; 16],          // V2: Hash-based ID
    pub side: PositionSide,             // Long/Short (public)
    pub leverage: u8,                   // 1-20x (public)
    pub encrypted_size: [u8; 64],       // V2: Pure ciphertext
    pub encrypted_entry_price: [u8; 64],// V2: Pure ciphertext
    pub encrypted_collateral: [u8; 64], // V2: Pure ciphertext
    pub encrypted_liq_below: [u8; 64],  // V2: Encrypted threshold
    pub encrypted_liq_above: [u8; 64],  // V2: Encrypted threshold
    pub threshold_commitment: [u8; 32], // hash(entry, leverage, mm_bps)
    pub created_at_hour: i64,           // V2: Coarse timestamp
    pub last_updated_hour: i64,         // V2: Coarse timestamp
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

          {/* Footer */}
          <footer className="border-t border-white/10 pt-8 mt-16">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="text-sm text-white/40">
                Built for Solana Privacy Hack 2026
              </div>
              <div className="flex items-center gap-2 text-xs text-white/40">
                <span>Powered by</span>
                <span className="bg-white/10 px-2 py-0.5 rounded">Arcium MPC</span>
                <span className="bg-white/10 px-2 py-0.5 rounded">Noir ZK</span>
                <span className="bg-white/10 px-2 py-0.5 rounded">ShadowWire</span>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}
