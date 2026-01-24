'use client';

import { FC, ReactNode, useMemo } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './theme-provider';
import { Toaster } from 'sonner';
import { RPC_ENDPOINT } from '@/lib/constants';
import { WebSocketProvider } from '@/hooks/streaming';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

interface ProvidersProps {
  children: ReactNode;
}

export const Providers: FC<ProvidersProps> = ({ children }) => {
  // Use centralized RPC endpoint (Helius if available, otherwise devnet)
  const endpoint = useMemo(() => RPC_ENDPOINT, []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ConnectionProvider endpoint={endpoint}>
          <WalletProvider wallets={wallets} autoConnect>
            <WalletModalProvider>
              <WebSocketProvider>
                {children}
              </WebSocketProvider>
              <Toaster
                position="bottom-right"
                richColors
                closeButton
                expand={false}
                visibleToasts={5}
                toastOptions={{
                  style: {
                    background: 'rgba(0, 0, 0, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    borderRadius: '12px',
                  },
                  className: 'font-sans',
                  descriptionClassName: 'text-white/60',
                }}
              />
            </WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};
