'use client';

/**
 * Admin Header
 *
 * Header bar with API key input for admin authentication.
 */

import { useAdminStore } from '@/stores/admin-store';
import { Eye, EyeSlash, Key } from '@phosphor-icons/react';
import { useState } from 'react';

export function AdminHeader() {
  const { apiKey, setApiKey } = useAdminStore();
  const [showKey, setShowKey] = useState(false);

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black">
      <div className="flex items-center gap-2">
        <span className="text-white/40 text-sm">Confidex</span>
        <span className="text-white/20">/</span>
        <span className="text-white text-sm font-medium">Admin</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg">
          <Key size={16} className="text-white/40" />
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API Key"
            className="bg-transparent text-white text-sm placeholder:text-white/30 focus:outline-none w-32 md:w-48"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
          >
            {showKey ? (
              <EyeSlash size={16} className="text-white/40" />
            ) : (
              <Eye size={16} className="text-white/40" />
            )}
          </button>
        </div>

        {apiKey ? (
          <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full">
            Authenticated
          </span>
        ) : (
          <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-full">
            No API Key
          </span>
        )}
      </div>
    </header>
  );
}
