'use client';

import { FC, useState, useCallback, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import {
  Lightning,
  ArrowRight,
  CheckCircle,
  Circle,
  ShieldCheck,
  Wallet,
  CloudArrowUp,
  Warning,
  SpinnerGap,
  Info,
  ArrowDown,
  CurrencyCircleDollar,
  Icon,
} from '@phosphor-icons/react';
import { useShadowWire } from '@/hooks/use-shadowwire';
import { cn } from '@/lib/utils';
import { SHADOWWIRE_FEE_BPS } from '@/lib/constants';
import type { SettlementToken } from '@/lib/settlement/types';

// Program ID for on-chain ShadowWire registration
const CONFIDEX_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB'
);

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: Icon;
}

interface ShadowWireOnboardingProps {
  /** Called when onboarding is complete */
  onComplete?: () => void;
  /** Called when user skips onboarding */
  onSkip?: () => void;
  /** Whether to show as modal or inline */
  variant?: 'modal' | 'inline' | 'card';
  /** Default tokens to enable */
  defaultTokens?: SettlementToken[];
  /** Class name for styling */
  className?: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'connect',
    title: 'Connect Wallet',
    description: 'Connect your Solana wallet to get started',
    icon: Wallet,
  },
  {
    id: 'initialize',
    title: 'Initialize Privacy Pool',
    description: 'Create your ShadowWire account for private transfers',
    icon: ShieldCheck,
  },
  {
    id: 'deposit',
    title: 'Deposit Tokens',
    description: 'Fund your privacy pool to enable private settlements',
    icon: CloudArrowUp,
  },
];

/**
 * ShadowWire Onboarding Component
 *
 * Guides users through the process of setting up ShadowWire for privacy-preserving
 * settlement. This involves:
 * 1. Connecting wallet
 * 2. Initializing a UserShadowWireAccount on-chain
 * 3. Depositing tokens into ShadowWire pool
 */
export const ShadowWireOnboarding: FC<ShadowWireOnboardingProps> = ({
  onComplete,
  onSkip,
  variant = 'card',
  defaultTokens = ['SOL', 'USDC'],
  className,
}) => {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { isReady, isInitializing, error: swError, transfer, getBalance } = useShadowWire();

  const [currentStep, setCurrentStep] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState<SettlementToken>('USDC');
  const [hasBalance, setHasBalance] = useState(false);

  // Determine current step based on state
  useEffect(() => {
    if (!connected) {
      setCurrentStep(0);
    } else if (!isInitialized && !isReady) {
      setCurrentStep(1);
    } else if (!hasBalance) {
      setCurrentStep(2);
    } else {
      // All complete
      onComplete?.();
    }
  }, [connected, isInitialized, isReady, hasBalance, onComplete]);

  // Check if user has ShadowWire balance
  useEffect(() => {
    const checkBalance = async () => {
      if (isReady && publicKey) {
        try {
          const solBalance = await getBalance('SOL');
          const usdcBalance = await getBalance('USDC');
          const hasSol = solBalance !== null && solBalance.available > 0;
          const hasUsdc = usdcBalance !== null && usdcBalance.available > 0;
          setHasBalance(hasSol || hasUsdc);
          if (hasSol || hasUsdc) {
            setIsInitialized(true);
          }
        } catch {
          // Ignore errors during balance check
        }
      }
    };
    checkBalance();
  }, [isReady, publicKey, getBalance]);

  // Check if user has on-chain ShadowWire account
  useEffect(() => {
    const checkAccount = async () => {
      if (connected && publicKey && connection) {
        try {
          const [accountPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('shadowwire_user'), publicKey.toBuffer()],
            CONFIDEX_PROGRAM_ID
          );
          const accountInfo = await connection.getAccountInfo(accountPda);
          setIsInitialized(!!accountInfo);
        } catch {
          setIsInitialized(false);
        }
      }
    };
    checkAccount();
  }, [connected, publicKey, connection]);

  /**
   * Initialize ShadowWire account on-chain
   */
  const handleInitialize = useCallback(async () => {
    if (!publicKey || !signTransaction || !connection) {
      setError('Wallet not connected');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Create register_shadowwire_account instruction
      // This creates a UserShadowWireAccount PDA that links wallet to ShadowWire pool
      const [accountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('shadowwire_user'), publicKey.toBuffer()],
        CONFIDEX_PROGRAM_ID
      );

      // For now, we'll use a placeholder pool address
      // In production, this would come from ShadowWire API
      const poolAddress = publicKey; // User's own wallet for now

      // Build instruction (simplified - actual would use Anchor)
      // TODO: Generate actual discriminator and use proper instruction encoding
      const instructionData = Buffer.alloc(8 + 32 + 4 + 32 * 2); // discriminator + pool + vec len + 2 mints
      // Discriminator for register_shadowwire_account (placeholder)
      instructionData.write('register', 0);

      // For now, skip on-chain registration and just mark as initialized
      // The actual registration will happen when the backend settles via ShadowWire
      setIsInitialized(true);
      setCurrentStep(2);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize';
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [publicKey, signTransaction, connection]);

  /**
   * Deposit tokens into ShadowWire pool
   */
  const handleDeposit = useCallback(async () => {
    if (!publicKey || !isReady) {
      setError('ShadowWire not ready');
      return;
    }

    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Convert to smallest units
      const decimals = selectedToken === 'USDC' ? 6 : 9;
      const amountInSmallestUnits = Math.floor(amount * Math.pow(10, decimals));

      // Execute deposit via ShadowWire
      // Note: In production, this would call the actual deposit API
      const result = await transfer({
        recipient: publicKey.toBase58(),
        amount: amountInSmallestUnits,
        token: selectedToken,
        type: 'external', // Deposit = external transfer to pool
      });

      if (result.success) {
        setHasBalance(true);
        setCurrentStep(3);
        onComplete?.();
      } else {
        setError('Deposit failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deposit failed';
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [publicKey, isReady, depositAmount, selectedToken, transfer, onComplete]);

  const getStepStatus = (stepIndex: number): 'completed' | 'active' | 'pending' => {
    if (stepIndex < currentStep) return 'completed';
    if (stepIndex === currentStep) return 'active';
    return 'pending';
  };

  const renderStepIcon = (step: OnboardingStep, status: 'completed' | 'active' | 'pending') => {
    const IconComponent = step.icon;

    if (status === 'completed') {
      return (
        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <CheckCircle size={24} weight="fill" className="text-emerald-400" />
        </div>
      );
    }

    if (status === 'active') {
      return (
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
          <IconComponent size={24} weight="duotone" className="text-primary" />
        </div>
      );
    }

    return (
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
        <Circle size={24} className="text-muted-foreground" />
      </div>
    );
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="text-center py-6">
            <Wallet size={48} className="mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">
              Connect your Solana wallet to enable private settlements
            </p>
            <p className="text-xs text-muted-foreground">
              Use the wallet button in the header to connect
            </p>
          </div>
        );

      case 1:
        return (
          <div className="py-6">
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <Info size={20} className="text-primary mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium mb-1">What is ShadowWire?</p>
                  <p className="text-muted-foreground">
                    ShadowWire uses Bulletproof ZK proofs to hide transfer amounts.
                    When you trade on Confidex, your order amounts stay private.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleInitialize}
              disabled={isProcessing || isInitializing}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium transition-colors',
                'bg-emerald-500 text-white hover:bg-emerald-600',
                (isProcessing || isInitializing) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {isProcessing ? (
                <>
                  <SpinnerGap size={16} className="animate-spin" />
                  Initializing...
                </>
              ) : (
                <>
                  Initialize Privacy Pool
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            <p className="text-xs text-muted-foreground text-center mt-3">
              This creates a ShadowWire account linked to your wallet
            </p>
          </div>
        );

      case 2:
        return (
          <div className="py-6">
            {/* Token Selection */}
            <div className="flex gap-2 mb-4">
              {defaultTokens.map((token) => (
                <button
                  key={token}
                  onClick={() => setSelectedToken(token)}
                  className={cn(
                    'flex-1 py-2 px-4 rounded-lg border transition-colors',
                    selectedToken === token
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-secondary text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {token}
                </button>
              ))}
            </div>

            {/* Amount Input */}
            <div className="relative mb-4">
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder={`Amount in ${selectedToken}`}
                className="w-full px-4 py-3 bg-secondary border border-border rounded-lg focus:border-primary focus:outline-none"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {selectedToken}
              </div>
            </div>

            {/* Fee Notice */}
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 text-sm text-amber-400">
                <CurrencyCircleDollar size={16} />
                <span>
                  {(SHADOWWIRE_FEE_BPS / 100).toFixed(0)}% fee for privacy protection
                </span>
              </div>
            </div>

            <button
              onClick={handleDeposit}
              disabled={isProcessing || !depositAmount}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium transition-colors',
                'bg-emerald-500 text-white hover:bg-emerald-600',
                (isProcessing || !depositAmount) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {isProcessing ? (
                <>
                  <SpinnerGap size={16} className="animate-spin" />
                  Depositing...
                </>
              ) : (
                <>
                  <ArrowDown size={16} />
                  Deposit to Pool
                </>
              )}
            </button>

            {onSkip && (
              <button
                onClick={onSkip}
                className="w-full mt-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip for now
              </button>
            )}
          </div>
        );

      default:
        return (
          <div className="text-center py-6">
            <CheckCircle size={48} weight="fill" className="mx-auto mb-4 text-emerald-400" />
            <p className="font-medium mb-2">You're all set!</p>
            <p className="text-sm text-muted-foreground">
              Your ShadowWire pool is ready for private settlements
            </p>
          </div>
        );
    }
  };

  const containerClasses = cn(
    'bg-card',
    variant === 'card' && 'border border-border rounded-xl',
    variant === 'modal' && 'fixed inset-0 z-50 flex items-center justify-center bg-black/50',
    className
  );

  const contentClasses = cn(
    variant === 'modal' && 'bg-card border border-border rounded-xl max-w-md w-full mx-4',
    'p-6'
  );

  return (
    <div className={containerClasses}>
      <div className={contentClasses}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Lightning size={28} weight="fill" className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Enable Private Settlement</h2>
            <p className="text-sm text-muted-foreground">
              Set up ShadowWire for hidden amounts
            </p>
          </div>
        </div>

        {/* Error Display */}
        {(error || swError) && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
            <Warning size={16} />
            {error || swError}
          </div>
        )}

        {/* Progress Steps */}
        <div className="space-y-4 mb-6">
          {ONBOARDING_STEPS.map((step, index) => {
            const status = getStepStatus(index);

            return (
              <div
                key={step.id}
                className={cn(
                  'flex items-center gap-4 p-3 rounded-lg transition-colors',
                  status === 'active' && 'bg-primary/5',
                  status === 'completed' && 'bg-emerald-500/5',
                  status === 'pending' && 'opacity-50'
                )}
              >
                {renderStepIcon(step, status)}
                <div className="flex-1">
                  <p className={cn(
                    'font-medium',
                    status === 'completed' && 'text-emerald-400',
                    status === 'active' && 'text-primary'
                  )}>
                    {step.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                {status === 'completed' && (
                  <CheckCircle size={20} weight="fill" className="text-emerald-400" />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        {renderStepContent()}
      </div>
    </div>
  );
};

export default ShadowWireOnboarding;
