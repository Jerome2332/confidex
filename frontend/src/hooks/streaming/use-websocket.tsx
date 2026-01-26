/**
 * Core WebSocket hook
 *
 * Provides connection management and subscription handling for Socket.IO.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ConnectionState,
  ConnectionStatus,
  ChannelType,
  ChannelSubscription,
  UseWebSocketOptions,
} from './types';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_OPTIONS: Required<UseWebSocketOptions> = {
  autoConnect: true,
  maxReconnectAttempts: 5,
  reconnectDelayMs: 1000,
  onStatusChange: () => {},
};

/**
 * Get WebSocket URL from environment
 */
function getWebSocketUrl(): string {
  // In production, use the same host as the API
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  // Socket.IO will automatically use wss:// for https:// URLs
  // But we need to ensure we're using https in production
  let finalUrl = apiUrl;
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    // If we're on HTTPS, ensure the API URL also uses HTTPS
    finalUrl = apiUrl.replace(/^http:/, 'https:');
  }

  // Debug logging for production troubleshooting
  if (typeof window !== 'undefined') {
    console.log('[WebSocket] Config:', {
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
      apiUrl,
      finalUrl,
      protocol: window.location.protocol,
    });
  }

  return finalUrl;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Core WebSocket connection hook
 *
 * Manages Socket.IO connection lifecycle and channel subscriptions.
 *
 * @example
 * ```tsx
 * const { isConnected, subscribe, unsubscribe } = useWebSocket();
 *
 * useEffect(() => {
 *   subscribe('orders', 'pair123');
 *   return () => unsubscribe('orders', 'pair123');
 * }, [subscribe, unsubscribe]);
 * ```
 */
export function useWebSocket(options: UseWebSocketOptions = {}) {
  // Memoize options to prevent infinite re-renders
  const opts = useMemo(
    () => ({
      ...DEFAULT_OPTIONS,
      ...options,
    }),
    [options.autoConnect, options.maxReconnectAttempts, options.reconnectDelayMs]
  );

  // Store onStatusChange in a ref to avoid dependency issues
  const onStatusChangeRef = useRef(options.onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = options.onStatusChange;
  }, [options.onStatusChange]);

  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: 'disconnected',
    reconnectAttempts: 0,
  });

  const socketRef = useRef<Socket | null>(null);
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Store options in refs to break circular dependencies
  const maxReconnectAttemptsRef = useRef(opts.maxReconnectAttempts);
  const reconnectDelayMsRef = useRef(opts.reconnectDelayMs);
  useEffect(() => {
    maxReconnectAttemptsRef.current = opts.maxReconnectAttempts;
    reconnectDelayMsRef.current = opts.reconnectDelayMs;
  }, [opts.maxReconnectAttempts, opts.reconnectDelayMs]);

  // Update status with callback - stable, no dependencies
  const updateStatus = useCallback((status: ConnectionStatus, error?: string) => {
    setConnectionState((prev) => ({
      ...prev,
      status,
      error,
      lastConnected: status === 'connected' ? new Date() : prev.lastConnected,
      reconnectAttempts: status === 'connected' ? 0 : prev.reconnectAttempts,
    }));
    onStatusChangeRef.current?.(status);
  }, []);

  // Use a ref to hold attemptReconnect to break circular dependency
  const attemptReconnectRef = useRef<() => void>(() => {});

  // Connect to WebSocket server - stable reference using refs
  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    updateStatus('connecting');

    const wsUrl = getWebSocketUrl();
    const isSecure = wsUrl.startsWith('https:');

    console.log('[WebSocket] Connecting to:', wsUrl, 'path: /ws', 'secure:', isSecure);

    const socket = io(wsUrl, {
      path: '/ws',
      // Use polling first for Render.com compatibility (no sticky sessions)
      // Socket.IO will upgrade to websocket after handshake
      transports: ['polling', 'websocket'],
      reconnection: false, // We handle reconnection manually
      timeout: 20000, // Longer timeout for Render cold starts
      secure: isSecure,
      // Required for CORS with credentials
      withCredentials: true,
      // Render may need longer timeouts for cold starts
      upgrade: true,
      rememberUpgrade: true,
    });

    socket.on('connect', () => {
      updateStatus('connected');

      // Resubscribe to channels after reconnect
      subscriptionsRef.current.forEach((sub) => {
        const [channel, filter] = sub.split(':');
        socket.emit('subscribe', { channel, filter: filter || undefined });
      });
    });

    socket.on('disconnect', (reason) => {
      updateStatus('disconnected');

      // Attempt reconnection for recoverable disconnects
      if (reason === 'io server disconnect') {
        // Server intentionally disconnected, don't reconnect
        return;
      }

      attemptReconnectRef.current();
    });

    socket.on('connect_error', (error) => {
      updateStatus('error', error.message);
      attemptReconnectRef.current();
    });

    socketRef.current = socket;
  }, [updateStatus]);

  // Attempt reconnection with exponential backoff - uses refs to avoid circular deps
  const attemptReconnect = useCallback(() => {
    setConnectionState((prev) => {
      const attempts = prev.reconnectAttempts + 1;

      if (attempts > maxReconnectAttemptsRef.current) {
        return { ...prev, status: 'error', error: 'Max reconnection attempts reached' };
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delay = reconnectDelayMsRef.current * Math.pow(2, attempts - 1);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);

      return { ...prev, reconnectAttempts: attempts };
    });
  }, [connect]);

  // Keep the ref updated
  useEffect(() => {
    attemptReconnectRef.current = attemptReconnect;
  }, [attemptReconnect]);

  // Disconnect from WebSocket server
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    subscriptionsRef.current.clear();
    updateStatus('disconnected');
  }, [updateStatus]);

  // Subscribe to a channel
  const subscribe = useCallback((channel: ChannelType, filter?: string) => {
    const key = filter ? `${channel}:${filter}` : channel;

    if (subscriptionsRef.current.has(key)) return;

    subscriptionsRef.current.add(key);

    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe', { channel, filter });
    }
  }, []);

  // Unsubscribe from a channel
  const unsubscribe = useCallback((channel: ChannelType, filter?: string) => {
    const key = filter ? `${channel}:${filter}` : channel;

    if (!subscriptionsRef.current.has(key)) return;

    subscriptionsRef.current.delete(key);

    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe', { channel, filter });
    }
  }, []);

  // Add event listener
  const on = useCallback(<T,>(event: string, callback: (data: T) => void) => {
    socketRef.current?.on(event, callback);

    return () => {
      socketRef.current?.off(event, callback);
    };
  }, []);

  // Store connect/disconnect in refs for stable effect
  const connectRef = useRef(connect);
  const disconnectRef = useRef(disconnect);
  useEffect(() => {
    connectRef.current = connect;
    disconnectRef.current = disconnect;
  }, [connect, disconnect]);

  // Capture autoConnect at mount time to prevent re-runs
  const autoConnectRef = useRef(opts.autoConnect);

  // Auto-connect on mount - runs exactly once
  useEffect(() => {
    if (autoConnectRef.current) {
      connectRef.current();
    }

    return () => {
      disconnectRef.current();
    };
  }, []);

  return {
    // Connection state
    isConnected: connectionState.status === 'connected',
    status: connectionState.status,
    error: connectionState.error,
    reconnectAttempts: connectionState.reconnectAttempts,

    // Actions
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    on,

    // Raw socket (for advanced use cases)
    socket: socketRef.current,
  };
}

// =============================================================================
// Context (Optional - for app-wide WebSocket)
// =============================================================================

import { createContext, useContext, type ReactNode } from 'react';

type WebSocketContextValue = ReturnType<typeof useWebSocket>;

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

/**
 * WebSocket provider for app-wide connection sharing
 */
export function WebSocketProvider({
  children,
  options,
}: {
  children: ReactNode;
  options?: UseWebSocketOptions;
}) {
  const websocket = useWebSocket(options);

  return (
    <WebSocketContext.Provider value={websocket}>{children}</WebSocketContext.Provider>
  );
}

/**
 * Use shared WebSocket connection from context
 */
export function useSharedWebSocket(): WebSocketContextValue {
  const context = useContext(WebSocketContext);

  if (!context) {
    throw new Error('useSharedWebSocket must be used within a WebSocketProvider');
  }

  return context;
}
