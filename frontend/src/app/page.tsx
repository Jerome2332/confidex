'use client';

import { Header } from '@/components/header';
import { ScrollTextReveal } from '@/components/scroll-text-reveal';
import { CircleAnimation } from '@/components/circle-animations';
import {
  Shield,
  Lock,
  Zap,
  ExternalLink,
  Github,
  BookOpen,
  ArrowRight,
  EyeOff,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

export default function LandingPage() {

  const features = [
    {
      icon: Lock,
      title: 'Encrypted Orders',
      description: 'Order amounts and prices are encrypted using Arcium MPC. No one can see your trading strategy.',
      tech: 'Arcium MPC',
    },
    {
      icon: Shield,
      title: 'ZK Compliance',
      description: 'Prove regulatory compliance without revealing your identity using zero-knowledge proofs.',
      tech: 'Noir ZK Proofs',
    },
    {
      icon: Zap,
      title: 'Private Settlement',
      description: 'Trades settle using confidential tokens. Your balances remain private on-chain.',
      tech: 'C-SPL Tokens',
    },
    {
      icon: EyeOff,
      title: 'MEV Protection',
      description: 'Encrypted orders prevent front-running and sandwich attacks. Trade without information leakage.',
      tech: 'Dark Pool',
    },
  ];

  const stats = [
    { label: 'Privacy Guarantee', value: '100%', description: 'Encrypted by default' },
    { label: 'Proof Generation', value: '<3s', description: 'Client-side ZK' },
    { label: 'MPC Latency', value: '~500ms', description: 'Order matching' },
  ];

  const techStack = [
    { name: 'Arcium MPC', description: 'Multi-party computation for encrypted order matching', animation: 'sonar-sweep' as const },
    { name: 'Noir ZK', description: 'Zero-knowledge proofs for compliance verification', animation: 'cylindrical-analysis' as const },
    { name: 'C-SPL Tokens', description: 'Confidential token standard for private settlement', animation: 'sphere-scan' as const },
    { name: 'ShadowWire', description: 'Bulletproof-based privacy layer for transfers', animation: 'crystalline-refraction' as const },
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
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            Solana Privacy Hack 2026
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-light mb-6 text-white leading-tight">
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
              className="group inline-flex items-center gap-2 bg-white text-black px-8 py-4 rounded-lg font-medium text-lg hover:bg-white/90 transition-all shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20"
            >
              Start Trading
              <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="https://docs.arcium.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white/10 text-white px-8 py-4 rounded-lg font-medium text-lg hover:bg-white/20 transition-colors border border-white/20"
            >
              Read Documentation
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap justify-center gap-8 md:gap-16">
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl md:text-4xl font-light font-mono text-white mb-1">
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
              <div
                key={i}
                className="group p-6 bg-white/5 border border-white/10 rounded-xl hover:border-white/30 transition-colors"
              >
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
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section - Responsible Privacy Architecture */}
      <section className="py-20 md:py-32 border-t border-white/10">
        <div className="container mx-auto px-4">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 text-xs font-light bg-white/10 text-white px-4 py-1.5 rounded-full mb-4 border border-white/20">
              <Shield className="h-3 w-3" />
              Responsible Privacy
            </div>
            <h2 className="text-3xl md:text-4xl font-light mb-4 text-white">
              Privacy with Accountability
            </h2>
            <p className="text-white/60 max-w-2xl mx-auto text-lg font-light">
              Our three-layer architecture delivers complete trading privacy while ensuring regulatory compliance — no anonymity without safeguards.
            </p>
          </div>

          {/* Architecture Diagram */}
          <div className="max-w-5xl mx-auto mb-16">
            <div className="grid md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-black text-xs px-3 py-1 rounded-full font-normal">
                  Layer 1: Compliance
                </div>
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 mt-2">
                  <Shield className="h-8 w-8 text-white" />
                </div>
                <h3 className="font-normal mb-2 text-white">Noir ZK Proofs</h3>
                <p className="text-sm text-white/60 font-light">
                  Prove you&apos;re not on OFAC/sanctions lists without revealing your wallet address
                </p>
                <div className="mt-4 text-xs bg-white/10 text-white/80 px-3 py-1.5 rounded-full inline-block font-light">
                  Groth16 via Sunspot
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-black text-xs px-3 py-1 rounded-full font-normal">
                  Layer 2: Execution
                </div>
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 mt-2">
                  <Lock className="h-8 w-8 text-white" />
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
                  Layer 3: Settlement
                </div>
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 mt-2">
                  <Zap className="h-8 w-8 text-white" />
                </div>
                <h3 className="font-normal mb-2 text-white">Confidential Tokens</h3>
                <p className="text-sm text-white/60 font-light">
                  Balances stay encrypted on-chain with C-SPL or ShadowWire Bulletproofs
                </p>
                <div className="mt-4 text-xs bg-white/10 text-white/80 px-3 py-1.5 rounded-full inline-block font-light">
                  Persistent Privacy
                </div>
              </div>
            </div>

            {/* Flow Arrow */}
            <div className="hidden md:flex justify-center items-center gap-4 text-white/50 text-sm font-light">
              <span>Prove Eligibility</span>
              <ArrowRight className="h-4 w-4" />
              <span>Encrypt & Match</span>
              <ArrowRight className="h-4 w-4" />
              <span>Settle Privately</span>
            </div>
          </div>

          {/* Why This Matters */}
          <div className="max-w-4xl mx-auto">
            <h3 className="text-xl font-normal text-center mb-8 text-white">Why This Architecture Wins</h3>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <EyeOff className="h-5 w-5 text-white" />
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
                  <Shield className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h4 className="font-normal mb-1 text-white">Regulatory Ready</h4>
                  <p className="text-sm text-white/60 font-light">
                    ZK compliance proofs satisfy KYC/AML requirements without compromising user privacy — accountability without surveillance.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Lock className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h4 className="font-normal mb-1 text-white">Institutional Grade</h4>
                  <p className="text-sm text-white/60 font-light">
                    Dark pool functionality enables large block trades without market impact — critical for institutional adoption.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h4 className="font-normal mb-1 text-white">Composable Privacy</h4>
                  <p className="text-sm text-white/60 font-light">
                    Built on Solana&apos;s ecosystem primitives (Arcium, Noir, C-SPL, ShadowWire) for maximum interoperability.
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
            <h2 className="text-3xl md:text-4xl font-light mb-4 text-white">
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
          <h2 className="text-3xl md:text-4xl font-light mb-4 text-white">
            Ready to Trade Privately?
          </h2>
          <p className="text-white/60 max-w-xl mx-auto mb-8 text-lg font-light">
            Connect your wallet and experience truly private trading on Solana.
          </p>
          <Link
            href="/trade"
            className="group inline-flex items-center gap-2 bg-white text-black px-8 py-4 rounded-lg font-medium text-lg hover:bg-white/90 transition-all shadow-lg shadow-white/10"
          >
            Launch App
            <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <Shield className="h-6 w-6 text-white" />
              <span className="font-normal text-white">Confidex</span>
              <span className="text-xs text-white/50 font-light">
                Built for Solana Privacy Hack 2026
              </span>
            </div>

            <div className="flex items-center gap-6">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/50 hover:text-white transition-colors"
              >
                <Github className="h-5 w-5" />
              </a>
              <a
                href="https://docs.arcium.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/50 hover:text-white transition-colors"
              >
                <BookOpen className="h-5 w-5" />
              </a>
            </div>

            <div className="flex items-center gap-2 text-xs text-white/50 font-light">
              <span>Powered by</span>
              <span className="bg-white/10 text-white/80 px-2 py-0.5 rounded">Arcium MPC</span>
              <span className="bg-white/10 text-white/80 px-2 py-0.5 rounded">Noir ZK</span>
              <span className="bg-white/10 text-white/80 px-2 py-0.5 rounded">ShadowWire</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
