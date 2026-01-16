'use client';

import { FC, useState } from 'react';
import { Shield, Settings, ExternalLink, TrendingUp, ArrowLeftRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletButton } from '@/components/wallet-button';
import { NavDropdown } from '@/components/nav-dropdown';
import { SettingsPanel } from '@/components/settings-panel';
import { MarketTicker } from '@/components/market-ticker';

interface HeaderProps {
  showMarketTicker?: boolean;
}

const tradeDropdownItems = [
  {
    href: '/trade/perpetuals',
    icon: TrendingUp,
    title: 'Perpetuals',
    description: 'Trade perp markets with up to 20x leverage',
  },
  {
    href: '/trade',
    icon: ArrowLeftRight,
    title: 'Spot',
    description: 'Trade assets',
  },
];

const navLinks = [
  { href: '/predict', label: 'Predict' },
  { href: '/wrap', label: 'Wrap/Unwrap' },
];

export const Header: FC<HeaderProps> = ({ showMarketTicker = false }) => {
  const [showSettings, setShowSettings] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <header className="border-b border-white/10 bg-black/95 backdrop-blur supports-[backdrop-filter]:bg-black/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Shield className="h-7 w-7 text-white" />
            <span className="text-xl font-bold text-white">Confidex</span>
            <span className="text-[10px] bg-white/10 text-white/80 px-1.5 py-0.5 rounded font-medium border border-white/20">
              DEVNET
            </span>
          </Link>

          {/* Navigation */}
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-1">
              {/* Trade Dropdown */}
              <NavDropdown
                label="Trade"
                items={tradeDropdownItems}
                basePath="/trade"
              />

              {/* Other Nav Links */}
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                    pathname === link.href
                      ? 'font-medium bg-white/10 text-white'
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {link.label}
                </Link>
              ))}

              {/* Docs Link */}
              <a
                href="https://docs.arcium.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm px-3 py-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1"
              >
                Docs
                <ExternalLink className="h-3 w-3" />
              </a>
            </nav>

            {/* Settings Button */}
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>

            {/* Wallet Button */}
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Market Ticker (optional) */}
      {showMarketTicker && <MarketTicker variant="bar" />}

      {/* Settings Panel Modal */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  );
};
