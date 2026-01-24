/**
 * Core WebSocket hook
 *
 * Provides connection management and subscription handling for Socket.IO.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  return apiUrl;
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
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: 'disconnected',
    reconnectAttempts: 0,
  });

  const socketRef = useRef<Socket | null>(null);
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update status with callback
  const updateStatus = useCallback(
    (status: ConnectionStatus, error?: string) => {
      setConnectionState((prev) => ({
        ...prev,
        status,
        error,
        lastConnected: status === 'connected' ? new Date() : prev.lastConnected,
        reconnectAttempts: status === 'connected' ? 0 : prev.reconnectAttempts,
      }));
      opts.onStatusChange(status);
    },
    [opts]
  );

  // Connect to WebSocket server
  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    updateStatus('connecting');

    const socket = io(getWebSocketUrl(), {
      path: '/ws',
      transports: ['websocket', 'polling'],
      reconnection: false, // We handle reconnection manually
      timeout: 10000,
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

      attemptReconnect();
    });

    socket.on('connect_error', (error) => {
      updateStatus('error', error.message);
      attemptReconnect();
    });

    socketRef.current = socket;
  }, [updateStatus]);

  // Attempt reconnection with exponential backoff
  const attemptReconnect = useCallback(() => {
    setConnectionState((prev) => {
      const attempts = prev.reconnectAttempts + 1;

      if (attempts > opts.maxReconnectAttempts) {
        return { ...prev, status: 'error', error: 'Max reconnection attempts reached' };
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delay = opts.reconnectDelayMs * Math.pow(2, attempts - 1);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);

      return { ...prev, reconnectAttempts: attempts };
    });
  }, [connect, opts.maxReconnectAttempts, opts.reconnectDelayMs]);

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

  // Auto-connect on mount
  useEffect(() => {
    if (opts.autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [opts.autoConnect, connect, disconnect]);

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
