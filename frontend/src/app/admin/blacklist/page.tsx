'use client';

import { useState, useEffect, useCallback } from 'react';

interface BlacklistStatus {
  addresses: string[];
  count: number;
  localMerkleRoot: string;
  onChainMerkleRoot: string;
  inSync: boolean;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function BlacklistAdminPage() {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<BlacklistStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isAddingAddress, setIsAddingAddress] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'remove' | 'sync';
    address?: string;
  } | null>(null);

  // Handle client-side mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['x-admin-api-key'] = apiKey;
      }

      const response = await fetch(`${BACKEND_URL}/api/admin/blacklist`, {
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized - check your API key');
        }
        throw new Error(`Failed to fetch blacklist: ${response.statusText}`);
      }

      const data = await response.json();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch blacklist');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  // Fetch on mount
  useEffect(() => {
    if (mounted) {
      fetchStatus();
    }
  }, [mounted, fetchStatus]);

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddress.trim()) return;

    try {
      setIsAddingAddress(true);
      setError(null);
      setSuccessMessage(null);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['x-admin-api-key'] = apiKey;
      }

      const response = await fetch(`${BACKEND_URL}/api/admin/blacklist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ address: newAddress.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add address');
      }

      setSuccessMessage(data.message);
      setNewAddress('');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add address');
    } finally {
      setIsAddingAddress(false);
    }
  };

  const handleRemoveAddress = async (address: string) => {
    try {
      setError(null);
      setSuccessMessage(null);
      setConfirmAction(null);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['x-admin-api-key'] = apiKey;
      }

      const response = await fetch(
        `${BACKEND_URL}/api/admin/blacklist/${encodeURIComponent(address)}`,
        {
          method: 'DELETE',
          headers,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove address');
      }

      setSuccessMessage(data.message);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove address');
    }
  };

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      setError(null);
      setSuccessMessage(null);
      setConfirmAction(null);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['x-admin-api-key'] = apiKey;
      }

      const response = await fetch(`${BACKEND_URL}/api/admin/blacklist/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync blacklist');
      }

      setSuccessMessage(
        data.signature
          ? `Synced to on-chain. Signature: ${data.signature}`
          : data.message
      );
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync blacklist');
    } finally {
      setIsSyncing(false);
    }
  };

  // Show loading state until mounted
  if (!mounted) {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-light mb-8">Blacklist Management</h1>
          <div className="text-white/60">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-light mb-8">Blacklist Management</h1>

        {/* Confirmation Modal */}
        {confirmAction && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-zinc-900 border border-white/20 rounded-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-medium mb-4">Confirm Action</h3>
              <p className="text-white/60 mb-6">
                {confirmAction.type === 'remove'
                  ? `Remove ${confirmAction.address} from blacklist?`
                  : 'Sync blacklist to on-chain? This requires the admin private key.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/20 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (confirmAction.type === 'remove' && confirmAction.address) {
                      handleRemoveAddress(confirmAction.address);
                    } else if (confirmAction.type === 'sync') {
                      handleSync();
                    }
                  }}
                  className="flex-1 px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-lg transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* API Key Input */}
        <div className="mb-8 p-4 bg-white/5 rounded-xl border border-white/10">
          <label className="block text-sm text-white/60 mb-2">Admin API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter admin API key (optional in dev)"
            className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:border-white/40"
          />
          <p className="text-xs text-white/40 mt-1">
            Required in production. Set via ADMIN_API_KEY env var on backend.
          </p>
        </div>

        {/* Status Card */}
        <div className="mb-8 p-6 bg-white/5 rounded-xl border border-white/10">
          <h2 className="text-lg font-light mb-4">Status</h2>

          {loading ? (
            <div className="text-white/60">Loading...</div>
          ) : error ? (
            <div className="text-rose-400/80">{error}</div>
          ) : status ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-white/60">Blacklisted addresses:</span>
                <span className="font-mono">{status.count}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">Local root:</span>
                <span className="font-mono text-xs truncate max-w-[300px]">
                  {status.localMerkleRoot}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">On-chain root:</span>
                <span className="font-mono text-xs truncate max-w-[300px]">
                  {status.onChainMerkleRoot}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">Sync status:</span>
                <span
                  className={`px-2 py-1 rounded-full text-xs ${
                    status.inSync
                      ? 'bg-emerald-500/20 text-emerald-400/80'
                      : 'bg-amber-500/20 text-amber-400/80'
                  }`}
                >
                  {status.inSync ? 'In Sync' : 'Out of Sync'}
                </span>
              </div>
              {!status.inSync && (
                <button
                  onClick={() => setConfirmAction({ type: 'sync' })}
                  disabled={isSyncing}
                  className="mt-4 w-full px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {isSyncing ? 'Syncing...' : 'Sync to On-Chain'}
                </button>
              )}
            </div>
          ) : (
            <div className="text-white/60">
              Unable to connect to backend. Make sure the backend server is running on port 3001.
            </div>
          )}
        </div>

        {/* Success/Error Messages */}
        {successMessage && (
          <div className="mb-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400/80">
            {successMessage}
          </div>
        )}

        {/* Add Address Form */}
        <div className="mb-8 p-6 bg-white/5 rounded-xl border border-white/10">
          <h2 className="text-lg font-light mb-4">Add Address to Blacklist</h2>
          <form onSubmit={handleAddAddress} className="flex gap-4">
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="Enter Solana address..."
              className="flex-1 bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={isAddingAddress || !newAddress.trim()}
              className="px-6 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400/80 border border-rose-500/30 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {isAddingAddress ? 'Adding...' : 'Add'}
            </button>
          </form>
        </div>

        {/* Address List */}
        <div className="p-6 bg-white/5 rounded-xl border border-white/10">
          <h2 className="text-lg font-light mb-4">
            Blacklisted Addresses ({status?.count ?? 0})
          </h2>

          {loading ? (
            <div className="text-white/60">Loading...</div>
          ) : !status ? (
            <div className="text-white/40 text-center py-8">Connect to backend to view addresses</div>
          ) : status.addresses.length === 0 ? (
            <div className="text-white/40 text-center py-8">No blacklisted addresses</div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {status.addresses.map((address) => (
                <div
                  key={address}
                  className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10"
                >
                  <span className="font-mono text-sm truncate max-w-[500px]">{address}</span>
                  <button
                    onClick={() => setConfirmAction({ type: 'remove', address })}
                    className="px-3 py-1 text-xs bg-white/10 hover:bg-rose-500/20 text-white/60 hover:text-rose-400/80 border border-white/10 hover:border-rose-500/30 rounded-lg transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Refresh Button */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/20 rounded-lg text-white/60 hover:text-white transition-colors disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  );
}
