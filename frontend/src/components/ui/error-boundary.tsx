'use client';

import { Component, ReactNode } from 'react';
import { ArrowCounterClockwise, Warning } from '@phosphor-icons/react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Reusable Error Boundary Component
 *
 * Wraps sections of the UI to catch and handle errors gracefully
 * without crashing the entire application.
 *
 * @example
 * <ErrorBoundary fallback={<CustomFallback />}>
 *   <RiskyComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          className="p-6 bg-white/5 border border-white/10 rounded-xl"
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-start gap-4">
            <div className="p-2 bg-rose-500/20 rounded-lg flex-shrink-0">
              <Warning size={24} className="text-rose-400" weight="fill" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-medium mb-1">Something went wrong</h3>
              <p className="text-white/60 text-sm mb-4">
                This section encountered an error. You can try again or continue using other parts of the app.
              </p>
              <button
                onClick={this.handleRetry}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-sm font-medium transition-colors"
                aria-label="Try loading this section again"
              >
                <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Compact error fallback for smaller UI sections
 */
export function CompactErrorFallback({
  message = 'Failed to load',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2 p-4 text-white/60"
      role="alert"
    >
      <Warning size={16} className="text-rose-400" aria-hidden="true" />
      <span className="text-sm">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-white/60 hover:text-white underline text-sm"
          aria-label="Retry"
        >
          Retry
        </button>
      )}
    </div>
  );
}
