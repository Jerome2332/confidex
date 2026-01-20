'use client';

import { FC, useState } from 'react';
import {
  CaretDown,
  CaretUp,
  Shield,
  Lightning,
  Wallet,
  X,
} from '@phosphor-icons/react';

interface FAQItem {
  id: string;
  question: string;
  answer: string | React.ReactNode;
  category: 'wallet' | 'privacy' | 'trading' | 'general';
}

const FAQ_ITEMS: FAQItem[] = [
  {
    id: 'wallet-warning',
    question: 'Why does my wallet show "Transaction reverted during simulation"?',
    answer: (
      <div className="space-y-3">
        <p>
          This warning is <strong>expected</strong> for Confidex transactions and does not mean your transaction will fail.
        </p>
        <p>
          Confidex uses Arcium MPC (Multi-Party Computation) for encrypted order matching.
          MPC operations require actual network execution and cannot be simulated locally by your wallet.
        </p>
        <p className="text-emerald-400/80">
          Your transaction will succeed when submitted to the network.
        </p>
      </div>
    ),
    category: 'wallet',
  },
  {
    id: 'unknown-program',
    question: 'Why does my wallet show "Unknown" for program instructions?',
    answer: (
      <div className="space-y-3">
        <p>
          Wallets like Phantom and Solflare need an IDL (Interface Definition Language) to decode
          transaction instructions into human-readable format.
        </p>
        <p>
          Since Confidex is a custom program, wallets display raw data instead of parsed instructions.
          This is normal for any new Solana program that wallets haven&apos;t integrated yet.
        </p>
      </div>
    ),
    category: 'wallet',
  },
  {
    id: 'no-amounts',
    question: 'Why can\'t I see the amounts in my wallet confirmation?',
    answer: (
      <div className="space-y-3">
        <p>
          <strong>This is privacy working as intended.</strong>
        </p>
        <p>
          Your order amounts, prices, and position sizes are encrypted as 64-byte ciphertext blobs
          using Arcium MPC encryption. Not even your wallet can decrypt these values.
        </p>
        <p>
          Only you can see your actual position values in the Confidex UI after decryption with your keys.
        </p>
      </div>
    ),
    category: 'privacy',
  },
  {
    id: 'encrypted-positions',
    question: 'What data is encrypted vs public in my positions?',
    answer: (
      <div className="space-y-3">
        <p><strong>Encrypted (Private):</strong></p>
        <ul className="list-disc list-inside ml-2 text-muted-foreground">
          <li>Position size</li>
          <li>Entry price</li>
          <li>Collateral amount</li>
          <li>Liquidation thresholds</li>
          <li>Realized PnL</li>
        </ul>
        <p className="mt-2"><strong>Public (Required for protocol):</strong></p>
        <ul className="list-disc list-inside ml-2 text-muted-foreground">
          <li>Position side (Long/Short) - needed for funding direction</li>
          <li>Leverage - needed for risk management</li>
          <li>Market - needed for routing</li>
          <li>Your wallet address - inherent to blockchain</li>
        </ul>
      </div>
    ),
    category: 'privacy',
  },
  {
    id: 'verify-transaction',
    question: 'How can I verify my transaction succeeded?',
    answer: (
      <div className="space-y-3">
        <p>
          After confirming the transaction in your wallet:
        </p>
        <ol className="list-decimal list-inside ml-2 space-y-1 text-muted-foreground">
          <li>Wait for the confirmation toast in Confidex</li>
          <li>Check the Positions tab - your new position will appear</li>
          <li>Click the transaction signature to view on Solana Explorer</li>
          <li>On Explorer, you&apos;ll see the SPL token transfer for collateral</li>
        </ol>
      </div>
    ),
    category: 'wallet',
  },
  {
    id: 'mpc-latency',
    question: 'Why do some operations take a few seconds?',
    answer: (
      <div className="space-y-3">
        <p>
          Confidex uses MPC (Multi-Party Computation) for encrypted operations like:
        </p>
        <ul className="list-disc list-inside ml-2 text-muted-foreground">
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
    ),
    category: 'trading',
  },
  {
    id: 'collateral-visible',
    question: 'Why is my collateral amount visible on Explorer?',
    answer: (
      <div className="space-y-3">
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
    ),
    category: 'privacy',
  },
  {
    id: 'zk-proof',
    question: 'What is the eligibility proof?',
    answer: (
      <div className="space-y-3">
        <p>
          Before trading, you generate a zero-knowledge (ZK) proof that proves you&apos;re
          not on the exchange&apos;s blacklist - without revealing your identity.
        </p>
        <p>
          This proof is generated client-side in ~2-3 seconds using Noir circuits and
          verified on-chain via Sunspot&apos;s Groth16 verifier.
        </p>
        <p className="text-muted-foreground">
          The proof only needs to be generated once per wallet address.
        </p>
      </div>
    ),
    category: 'privacy',
  },
];

const CATEGORY_ICONS = {
  wallet: Wallet,
  privacy: Shield,
  trading: Lightning,
  general: Shield, // Use Shield as fallback for general
};

const CATEGORY_LABELS = {
  wallet: 'Wallet & Transactions',
  privacy: 'Privacy & Encryption',
  trading: 'Trading',
  general: 'General',
};

interface FAQItemProps {
  item: FAQItem;
  isOpen: boolean;
  onToggle: () => void;
}

const FAQItemComponent: FC<FAQItemProps> = ({ item, isOpen, onToggle }) => {
  const Icon = CATEGORY_ICONS[item.category];

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon size={18} className="text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">{item.question}</span>
        </div>
        {isOpen ? (
          <CaretUp size={16} className="text-muted-foreground shrink-0" />
        ) : (
          <CaretDown size={16} className="text-muted-foreground shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-0">
          <div className="pl-7 text-sm text-muted-foreground leading-relaxed">
            {item.answer}
          </div>
        </div>
      )}
    </div>
  );
};

interface FAQPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: 'wallet' | 'privacy' | 'trading' | 'general';
}

export const FAQPanel: FC<FAQPanelProps> = ({ isOpen, onClose, initialCategory }) => {
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<string | null>(initialCategory || null);

  const toggleItem = (id: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredItems = selectedCategory
    ? FAQ_ITEMS.filter((item) => item.category === selectedCategory)
    : FAQ_ITEMS;

  const categories = ['wallet', 'privacy', 'trading', 'general'] as const;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-white/10 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-lg">?</span>
            <h2 className="text-lg font-medium">Frequently Asked Questions</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 p-4 border-b border-white/10 overflow-x-auto">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
              selectedCategory === null
                ? 'bg-white/20 text-white'
                : 'bg-white/5 text-muted-foreground hover:bg-white/10'
            }`}
          >
            All
          </button>
          {categories.map((cat) => {
            const Icon = CATEGORY_ICONS[cat];
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-white/20 text-white'
                    : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                }`}
              >
                <Icon size={14} />
                {CATEGORY_LABELS[cat]}
              </button>
            );
          })}
        </div>

        {/* FAQ Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredItems.map((item) => (
            <FAQItemComponent
              key={item.id}
              item={item}
              isOpen={openItems.has(item.id)}
              onToggle={() => toggleItem(item.id)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-amber-500/10">
          <div className="flex items-start gap-2 text-xs text-amber-400/80">
            <span className="shrink-0 mt-0.5">⚠</span>
            <p>
              <strong>Note:</strong> Wallet warnings about &quot;simulation failed&quot; are expected
              for privacy-preserving transactions. Your transactions will succeed when submitted.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Small FAQ button to open the panel
 */
export const FAQButton: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
    title="Frequently Asked Questions"
  >
    <span className="text-sm">?</span>
    FAQ
  </button>
);

export default FAQPanel;
