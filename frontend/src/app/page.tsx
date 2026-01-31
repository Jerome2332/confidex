'use client';

import { Header } from '@/components/header';
import { ScrollTextReveal } from '@/components/scroll-text-reveal';
import { CircleAnimation } from '@/components/circle-animations';
import { ConicBorderAnimation } from '@/components/conic-border-animation';
import { LogoIcon } from '@/components/logo';
import {
  Lock,
  Fingerprint,
  EyeClosed,
  ShieldCheck,
  ArrowRight,
  ArrowSquareOut,
  GithubLogo,
  BookOpen,
  Lightning,
  Pulse,
  Coin,
} from '@phosphor-icons/react';
import Link from 'next/link';
import Image from 'next/image';

export default function LandingPage() {

  const features = [
    {
      icon: Lock,
      title: 'Encrypted Orders',
      description: 'Order amounts and prices are fully encrypted using V2 pure ciphertext format. No one can see your trading strategy.',
      tech: 'Arcium MPC',
    },
    {
      icon: Fingerprint,
      title: 'Encrypted Orders',
      description: 'All order data encrypted via MPC - price, quantity, and trader identity hidden from observers.',
      tech: 'Arcium MPC',
    },
    {
      icon: EyeClosed,
      title: 'Encrypted Liquidations',
      description: 'Liquidation thresholds are encrypted via MPC batch verification. Entry prices cannot be reverse-engineered.',
      tech: 'V2 Privacy',
    },
    {
      icon: ShieldCheck,
      title: 'MEV Protection',
      description: 'Encrypted orders, hash-based IDs, and coarse timestamps prevent front-running and activity correlation.',
      tech: 'Dark Pool',
    },
    {
      icon: Pulse,
      title: 'Real-Time Streaming',
      description: 'Instant order and trade updates via WebSocket. See market activity in real-time without revealing private data.',
      tech: 'Socket.IO',
    },
    {
      icon: Coin,
      title: 'Rent-Free Storage',
      description: 'ZK Compression eliminates Solana rent costs. Store accounts for 400x less than traditional token accounts.',
      tech: 'Light Protocol',
    },
  ];

  const stats = [
    { label: 'Privacy Level', value: 'V2', description: 'Pure ciphertext format' },
    { label: 'Proof Generation', value: '<3s', description: 'Server-side ZK' },
    { label: 'MPC Batch Check', value: '10 pos', description: 'Liquidation verification' },
  ];

  const techStack = [
    { name: 'Arcium MPC', description: 'Multi-party computation for encrypted order matching - primary privacy layer', animation: 'sonar-sweep' as const },
    { name: 'ShadowWire', description: 'Bulletproof-based privacy layer for private token transfers', animation: 'crystalline-refraction' as const },
    { name: 'Light Protocol', description: 'ZK Compression for rent-free token accounts (400x savings)', animation: 'sphere-scan' as const },
    { name: 'Noir ZK', description: 'Optional zero-knowledge proofs for compliance verification', animation: 'cylindrical-analysis' as const },
  ];

  return (
    <main className="min-h-screen bg-black">
      {/* Header */}
      <Header />

      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 md:py-32">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-white/5 rounded-full blur-3xl" />
        <div className="absolute top-20 right-1/4 w-[400px] h-[400px] bg-white/3 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-white/2 rounded-full blur-3xl" />

        <div className="container mx-auto px-4 text-center relative">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 text-xs font-light bg-white/10 text-white px-4 py-1.5 rounded-full mb-6 border border-white/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            Solana Privacy Hack 2026
          </div>

          <h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-light mb-6 text-white leading-tight">
            Trade with
            <br />
            Complete Privacy
          </h1>

          <p className="text-white/60 max-w-2xl mx-auto mb-10 text-lg md:text-xl font-light">
            The first <span className="text-white font-normal">confidential DEX</span> on Solana.
            Your order amounts and prices stay encrypted. Compliance verified via zero-knowledge proofs.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link
              href="/trade"
              className="group inline-flex items-center gap-2.5 bg-transparent text-white px-7 py-3.5 rounded-full font-normal text-base border border-white/40 hover:border-white hover:bg-white/5 transition-all duration-200"
            >
              Start Trading
              <ArrowRight size={18} weight="light" className="group-hover:translate-x-0.5 transition-transform duration-200" />
            </Link>
            <a
              href="https://docs.arcium.com"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2.5 bg-transparent text-white/70 px-7 py-3.5 rounded-full font-normal text-base border border-white/20 hover:border-white/40 hover:text-white transition-all duration-200"
            >
              Documentation
              <ArrowSquareOut size={16} weight="light" className="group-hover:translate-y-[-1px] group-hover:translate-x-[1px] transition-transform duration-200" />
            </a>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap justify-center gap-8 md:gap-16">
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl md:text-4xl font-light font-iosevka text-white mb-1">
                  {stat.value}
                </div>
                <div className="text-sm font-normal text-white/80">{stat.label}</div>
                <div className="text-xs font-light text-white/50">{stat.description}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 md:py-32 border-t border-white/10">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16 flex flex-col items-center">
            <ScrollTextReveal
              text="Privacy-First Trading"
              placeholderChar="·"
              className="text-3xl md:text-4xl font-light mb-4 text-white"
              as="h2"
            />
            <ScrollTextReveal
              text="Built with cutting-edge cryptographic primitives to ensure your trading activity remains confidential."
              placeholderChar="·"
              className="text-white/60 max-w-2xl text-lg font-light"
              as="p"
              startThreshold={0.85}
              endThreshold={0.4}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {features.map((feature, i) => (
              <ConicBorderAnimation
                key={i}
                borderRadius={12}
                borderWidth={1}
                duration={6}
                className="w-full"
              >
                <div className="group p-6 h-full">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 group-hover:bg-white/20 transition-colors">
                      <feature.icon className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-normal mb-2 text-white">{feature.title}</h3>
                      <p className="text-white/60 text-sm font-light mb-3">{feature.description}</p>
                      <span className="inline-flex items-center text-xs bg-white/10 text-white/80 px-2 py-1 rounded font-light">
                        {feature.tech}
                      </span>
                    </div>
                  </div>
                </div>
              </ConicBorderAnimation>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section - Responsible Privacy Architecture */}
      <section className="py-20 md:py-32 border-t border-white/10">
        <div className="container mx-auto px-4">
          <div className="text-center mb-8">
            <div className="group inline-flex items-center gap-2 text-xs font-light bg-white/10 text-white px-4 py-1.5 rounded-full mb-4 border border-white/20 hover:bg-green-500/10 hover:border-green-500/30 transition-all duration-200 cursor-default">
              <Fingerprint size={16} className="text-white group-hover:text-green-500 transition-colors duration-200" />
              <span className="group-hover:text-green-500 transition-colors duration-200">Responsible Privacy</span>
            </div>
            <h2 className="font-display text-3xl md:text-4xl font-light mb-4 text-white">
              Privacy with Accountability
            </h2>
            <p className="text-white/60 max-w-2xl mx-auto text-lg font-light">
              Our two-layer privacy architecture delivers complete trading privacy — all order data encrypted, with private settlement.
            </p>
          </div>

          {/* Architecture Diagram - Three Privacy Layers */}
          <div className="max-w-5xl mx-auto mb-16">
            <div className="grid md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-black text-xs px-3 py-1 rounded-full font-normal">
                  Layer 1: Execution
                </div>
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 mt-2">
                  <Lock size={32} className="text-white" />
                </div>
                <h3 className="font-normal mb-2 text-white">Arcium MPC</h3>
                <p className="text-sm text-white/60 font-light">
                  Orders matched on encrypted data — prices compared without ever being revealed
                </p>
                <div className="mt-4 text-xs bg-white/10 text-white/80 px-3 py-1.5 rounded-full inline-block font-light">
                  Cerberus Protocol
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-black text-xs px-3 py-1 rounded-full font-normal">
                  Layer 2: Settlement
                </div>
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 mt-2">
                  <EyeClosed size={32} className="text-white" />
                </div>
                <h3 className="font-normal mb-2 text-white">ShadowWire</h3>
                <p className="text-sm text-white/60 font-light">
                  Balances stay encrypted on-chain with Bulletproof range proofs (C-SPL coming soon)
                </p>
                <div className="mt-4 text-xs bg-white/10 text-white/80 px-3 py-1.5 rounded-full inline-block font-light">
                  Bulletproof Privacy
                </div>
              </div>
            </div>

            {/* Flow Arrow */}
            <div className="hidden md:flex justify-center items-center gap-3 text-white/50 text-sm font-light">
              <span>Prove Eligibility</span>
              <ArrowRight size={16} />
              <span>Encrypt & Match</span>
              <ArrowRight size={16} />
              <span>Settle Privately</span>
            </div>
          </div>

          {/* Why This Matters */}
          <div className="max-w-4xl mx-auto">
            <h3 className="text-xl font-normal text-center mb-8 text-white">Why This Architecture Wins</h3>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <ShieldCheck size={20} className="text-white" />
                </div>
                <div>
                  <h4 className="font-normal mb-1 text-white">MEV Protection</h4>
                  <p className="text-sm text-white/60 font-light">
                    Encrypted orders eliminate front-running, sandwich attacks, and information leakage that costs traders millions daily.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <EyeClosed size={20} className="text-white" />
                </div>
                <div>
                  <h4 className="font-normal mb-1 text-white">V2 Pure Ciphertext</h4>
                  <p className="text-sm text-white/60 font-light">
                    No plaintext prefix — order amounts, prices, and liquidation thresholds are fully encrypted. Entry prices cannot be derived.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Lock size={20} className="text-white" />
                </div>
                <div>
                  <h4 className="font-normal mb-1 text-white">Anti-Correlation</h4>
                  <p className="text-sm text-white/60 font-light">
                    Hash-based IDs prevent sequential tracking. Hour-precision timestamps reduce temporal correlation attacks.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Fingerprint size={20} className="text-white" />
                </div>
                <div>
                  <h4 className="font-normal mb-1 text-white">Regulatory Ready</h4>
                  <p className="text-sm text-white/60 font-light">
                    ZK compliance proofs satisfy KYC/AML requirements without compromising user privacy — accountability without surveillance.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack Section */}
      <section className="py-20 md:py-32 border-t border-white/10">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-light mb-4 text-white">
              Built on Proven Technology
            </h2>
            <p className="text-white/60 max-w-2xl mx-auto text-lg font-light">
              Leveraging the most advanced cryptographic protocols in the Solana ecosystem.
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {techStack.map((tech, i) => (
              <div key={i} className="flex flex-col items-center">
                <CircleAnimation type={tech.animation} title="" />
                <h3 className="text-white font-normal mt-4 mb-2">{tech.name}</h3>
                <p className="text-sm text-white/60 text-center max-w-[200px] font-light">{tech.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 md:py-32 border-t border-white/10">
        <div className="container mx-auto px-4 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-light mb-4 text-white">
            Ready to Trade Privately?
          </h2>
          <p className="text-white/60 max-w-xl mx-auto mb-8 text-lg font-light">
            Connect your wallet and experience truly private trading on Solana.
          </p>
          <Link
            href="/trade"
            className="group inline-flex items-center gap-2.5 bg-transparent text-white px-7 py-3.5 rounded-full font-normal text-base border border-white/40 hover:border-white hover:bg-white/5 transition-all duration-200"
          >
            Launch App
            <ArrowRight size={18} weight="light" className="group-hover:translate-x-0.5 transition-transform duration-200" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <LogoIcon size={42} />
              <span className="text-xs text-white/50 font-light">
                Built for Solana Privacy Hack 2026
              </span>
            </div>

            <div className="flex items-center gap-6">
              <a
                href="https://github.com/Jerome2332/confidex"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/50 hover:text-white transition-colors"
              >
                <GithubLogo size={20} />
              </a>
              <a
                href="https://www.confidex.xyz/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/50 hover:text-white transition-colors"
              >
                <BookOpen size={20} />
              </a>
            </div>

            <div className="flex items-center gap-4 text-xs text-white/50 font-light flex-wrap justify-center md:justify-end">
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
                  width={28}
                  height={28}
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
                  width={28}
                  height={28}
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
                  width={28}
                  height={28}
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
                  width={34}
                  height={34}
                />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
