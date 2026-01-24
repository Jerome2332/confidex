'use client';

/**
 * Blacklist Management Page
 *
 * Manage blacklisted addresses and sync to on-chain.
 * Integrated into admin layout.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuth } from '@/hooks/admin';
import { ArrowClockwise, Warning, Plus, Trash, ArrowsClockwise } from '@phosphor-icons/react';
import { toast } from 'sonner';

interface BlacklistStatus {
  addresses: string[];
  count: number;
  localMerkleRoot: string;
  onChainMerkleRoot: string;
  inSync: boolean;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function BlacklistAdminPage() {
  const { authHeaders, isAuthenticated } = useAdminAuth();
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<BlacklistStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState('');
  const [isAddingAddress, setIsAddingAddress] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'remove' | 'sync';
    address?: string;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('[Blacklist] Fetching with headers:', authHeaders);
      const response = await fetch(`${BACKEND_URL}/api/admin/blacklist`, {
        headers: authHeaders,
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
  }, [authHeaders]);

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

      const response = await fetch(`${BACKEND_URL}/api/admin/blacklist`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ address: newAddress.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add address');
      }

      toast.success(data.message || 'Address added to blacklist');
      setNewAddress('');
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add address');
    } finally {
      setIsAddingAddress(false);
    }
  };

  const handleRemoveAddress = async (address: string) => {
    try {
      setError(null);
      setConfirmAction(null);

      const response = await fetch(
        `${BACKEND_URL}/api/admin/blacklist/${encodeURIComponent(address)}`,
        {
          method: 'DELETE',
          headers: authHeaders,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove address');
      }

      toast.success(data.message || 'Address removed from blacklist');
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove address');
    }
  };

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      setError(null);
      setConfirmAction(null);

      const response = await fetch(`${BACKEND_URL}/api/admin/blacklist/sync`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync blacklist');
      }

      toast.success(
        data.signature
          ? `Synced to on-chain. Tx: ${data.signature.slice(0, 16)}...`
          : data.message
      );
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync blacklist');
    } finally {
      setIsSyncing(false);
    }
  };

  if (!mounted) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-light text-white">Blacklist Management</h1>
        <div className="text-white/60">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-white/20 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-white mb-4">Confirm Action</h3>
            <p className="text-white/60 mb-6">
              {confirmAction.type === 'remove'
                ? `Remove ${confirmAction.address} from blacklist?`
                : 'Sync blacklist to on-chain? This requires the admin private key.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/20 rounded-lg transition-colors text-white"
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

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light text-white">Blacklist Management</h1>
          <p className="text-white/60 mt-1">Manage blacklisted addresses</p>
        </div>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <ArrowClockwise size={20} className={`text-white/60 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Auth Warning */}
      {!isAuthenticated && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-3">
          <Warning size={20} className="text-amber-400" />
          <span className="text-amber-400 text-sm">Enter API key in the header to manage blacklist</span>
        </div>
      )}

      {/* Status Card */}
      <div className="p-6 bg-white/5 rounded-lg border border-white/10">
        <h2 className="text-lg font-medium text-white mb-4">Status</h2>

        {loading ? (
          <div className="text-white/60">Loading...</div>
        ) : error ? (
          <div className="text-rose-400">{error}</div>
        ) : status ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-white/60 text-sm">Blacklisted Addresses</div>
                <div className="text-2xl font-medium text-white mt-1">{status.count}</div>
              </div>
              <div>
                <div className="text-white/60 text-sm">Sync Status</div>
                <div className="mt-1">
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                      status.inSync
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {status.inSync ? 'In Sync' : 'Out of Sync'}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/60">Local Root</span>
                <span className="font-mono text-xs text-white/80 truncate max-w-[300px]">
                  {status.localMerkleRoot.slice(0, 24)}...
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/60">On-chain Root</span>
                <span className="font-mono text-xs text-white/80 truncate max-w-[300px]">
                  {status.onChainMerkleRoot.slice(0, 24)}...
                </span>
              </div>
            </div>

            {!status.inSync && (
              <button
                onClick={() => setConfirmAction({ type: 'sync' })}
                disabled={isSyncing}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg font-medium transition-colors disabled:opacity-50 text-white"
              >
                <ArrowsClockwise size={18} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Syncing...' : 'Sync to On-Chain'}
              </button>
            )}
          </div>
        ) : (
          <div className="text-white/60">
            Unable to connect to backend. Make sure the backend server is running.
          </div>
        )}
      </div>

      {/* Add Address Form */}
      <div className="p-6 bg-white/5 rounded-lg border border-white/10">
        <h2 className="text-lg font-medium text-white mb-4">Add Address</h2>
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
            className="flex items-center gap-2 px-6 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Plus size={18} />
            {isAddingAddress ? 'Adding...' : 'Add'}
          </button>
        </form>
      </div>

      {/* Address List */}
      <div className="p-6 bg-white/5 rounded-lg border border-white/10">
        <h2 className="text-lg font-medium text-white mb-4">
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
                <span className="font-mono text-sm text-white truncate max-w-[500px]">{address}</span>
                <button
                  onClick={() => setConfirmAction({ type: 'remove', address })}
                  className="flex items-center gap-1 px-3 py-1 text-xs bg-white/10 hover:bg-rose-500/20 text-white/60 hover:text-rose-400 border border-white/10 hover:border-rose-500/30 rounded-lg transition-colors"
                >
                  <Trash size={14} />
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
