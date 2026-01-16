'use client';

import { Header } from '@/components/header';
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
    { name: 'Arcium MPC', description: 'Multi-party computation for encrypted order matching' },
    { name: 'Noir ZK', description: 'Zero-knowledge proofs for compliance verification' },
    { name: 'C-SPL Tokens', description: 'Confidential token standard for private settlement' },
    { name: 'ShadowWire', description: 'Bulletproof-based privacy layer for transfers' },
  ];

  return (
    <main className="min-h-screen">
      {/* Header */}
      <Header />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute top-20 right-1/4 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blue-500/5 rounded-full blur-3xl" />

        <div className="container mx-auto px-4 py-20 md:py-32 text-center relative">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 text-xs bg-primary/10 text-primary px-4 py-1.5 rounded-full mb-6 border border-primary/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Solana Privacy Hack 2026
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground to-primary leading-tight">
            Trade with
            <br />
            Complete Privacy
          </h1>

          <p className="text-muted-foreground max-w-2xl mx-auto mb-10 text-lg md:text-xl">
            The first <span className="text-foreground font-semibold">confidential DEX</span> on Solana.
            Your order amounts and prices stay encrypted. Compliance verified via zero-knowledge proofs.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link
              href="/trade"
              className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-lg font-semibold text-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30"
            >
              Start Trading
              <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="https://docs.arcium.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-secondary text-foreground px-8 py-4 rounded-lg font-semibold text-lg hover:bg-secondary/80 transition-colors"
            >
              Read Documentation
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap justify-center gap-8 md:gap-16">
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl md:text-4xl font-bold font-mono text-primary mb-1">
                  {stat.value}
                </div>
                <div className="text-sm font-medium text-foreground">{stat.label}</div>
                <div className="text-xs text-muted-foreground">{stat.description}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 md:py-32 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Privacy-First Trading
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Built with cutting-edge cryptographic primitives to ensure your trading activity remains confidential.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {features.map((feature, i) => (
              <div
                key={i}
                className="group p-6 bg-card border border-border rounded-xl hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                    <p className="text-muted-foreground text-sm mb-3">{feature.description}</p>
                    <span className="inline-flex items-center text-xs bg-secondary px-2 py-1 rounded font-medium">
                      {feature.tech}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 md:py-32 bg-secondary/30 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              How It Works
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Three layers of privacy protection for every trade.
            </p>
          </div>

          <div className="max-w-4xl mx-auto">
            <div className="space-y-6">
              {[
                {
                  step: '1',
                  title: 'Generate Eligibility Proof',
                  description: 'Client-side ZK proof generation verifies you\'re not on any blacklist without revealing your identity.',
                  time: '~2-3 seconds',
                },
                {
                  step: '2',
                  title: 'Encrypt Order Parameters',
                  description: 'Your order amount and price are encrypted using Arcium MPC. Only matching orders can compare prices.',
                  time: 'Instant',
                },
                {
                  step: '3',
                  title: 'Private Settlement',
                  description: 'When orders match, trades settle using confidential tokens. Balances remain encrypted on-chain.',
                  time: '~500ms',
                },
              ].map((item, i) => (
                <div key={i} className="flex gap-6 items-start">
                  <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg flex-shrink-0">
                    {item.step}
                  </div>
                  <div className="flex-1 pb-6 border-b border-border last:border-0">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-semibold">{item.title}</h3>
                      <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded">
                        {item.time}
                      </span>
                    </div>
                    <p className="text-muted-foreground">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack Section */}
      <section className="py-20 md:py-32 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Built on Proven Technology
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Leveraging the most advanced cryptographic protocols in the Solana ecosystem.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
            {techStack.map((tech, i) => (
              <div
                key={i}
                className="p-5 bg-card border border-border rounded-lg text-center hover:border-primary/50 transition-colors"
              >
                <h3 className="font-semibold mb-2">{tech.name}</h3>
                <p className="text-sm text-muted-foreground">{tech.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 md:py-32 border-t border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-transparent" />
        <div className="container mx-auto px-4 text-center relative">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Ready to Trade Privately?
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto mb-8 text-lg">
            Connect your wallet and experience truly private trading on Solana.
          </p>
          <Link
            href="/trade"
            className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-lg font-semibold text-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
          >
            Launch App
            <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <Shield className="h-6 w-6 text-primary" />
              <span className="font-semibold">Confidex</span>
              <span className="text-xs text-muted-foreground">
                Built for Solana Privacy Hack 2026
              </span>
            </div>

            <div className="flex items-center gap-6">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="h-5 w-5" />
              </a>
              <a
                href="https://docs.arcium.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <BookOpen className="h-5 w-5" />
              </a>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Powered by</span>
              <span className="bg-secondary px-2 py-0.5 rounded">Arcium MPC</span>
              <span className="bg-secondary px-2 py-0.5 rounded">Noir ZK</span>
              <span className="bg-secondary px-2 py-0.5 rounded">ShadowWire</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
