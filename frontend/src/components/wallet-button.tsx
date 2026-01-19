'use client';

import { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Wallet, SignOut, Check, Copy } from '@phosphor-icons/react';
import { useState } from 'react';
import { toast } from 'sonner';

export const WalletButton: FC = () => {
  const { publicKey, disconnect, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (publicKey) {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      toast.success('Address copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!connected || !publicKey) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-lg font-medium hover:bg-white/90 transition-colors"
      >
        <Wallet size={16} />
        Connect Wallet
      </button>
    );
  }

  const shortAddress = `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 bg-white/10 border border-white/20 px-3 py-2 rounded-lg">
        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
        <span className="text-sm font-mono text-white">{shortAddress}</span>
        <button
          onClick={handleCopy}
          className="text-white/60 hover:text-white transition-colors"
        >
          {copied ? (
            <Check size={16} className="text-white" />
          ) : (
            <Copy size={16} />
          )}
        </button>
      </div>
      <button
        onClick={disconnect}
        className="p-2 text-white/60 hover:text-red-400 transition-colors"
        title="Disconnect"
      >
        <SignOut size={16} />
      </button>
    </div>
  );
};
