/**
 * Admin Auth Hook
 *
 * Provides API key and authentication helpers for admin endpoints.
 */

import { useAdminStore } from '@/stores/admin-store';
import { useMemo } from 'react';

export function useAdminAuth() {
  const { apiKey, setApiKey, clearApiKey } = useAdminStore();

  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    return headers;
  }, [apiKey]);

  const isAuthenticated = Boolean(apiKey);

  return {
    apiKey,
    setApiKey,
    clearApiKey,
    authHeaders,
    isAuthenticated,
  };
}
