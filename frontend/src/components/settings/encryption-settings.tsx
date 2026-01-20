'use client';

/**
 * Encryption Settings Panel
 *
 * Allows users to configure encryption provider preferences at runtime.
 * Settings are persisted to localStorage and take effect immediately.
 *
 * Priority cascade:
 * 1. ENV_FORCE_PROVIDER (admin override, not shown in UI)
 * 2. User preference (this panel)
 * 3. Auto-selection (default)
 */

import { useState, useRef, useEffect } from 'react';
import { useSettingsStore, type PreferredEncryptionProvider } from '@/stores/settings-store';
import { useUnifiedEncryption } from '@/hooks/use-unified-encryption';
import { LockKey, Cloud, Warning, Check, Info, CaretDown } from '@phosphor-icons/react';
import { ENV_FORCE_PROVIDER, ENV_ARCIUM_ENABLED, INCO_ENABLED } from '@/lib/constants';

const PROVIDER_OPTIONS: { value: PreferredEncryptionProvider; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto (Best Available)', description: 'System automatically selects the best available provider' },
  { value: 'arcium', label: 'Arcium MPC', description: 'Multi-party computation with cryptographic security guarantees' },
  { value: 'inco', label: 'Inco TEE', description: 'Trusted execution environment with hardware-based security' },
];

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  return (
    <label
      className={`flex items-center justify-between rounded-lg bg-white/5 p-3 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-white/10'
      }`}
    >
      <div className="flex-1">
        <div className="text-sm font-medium text-white">{label}</div>
        <div className="text-xs text-white/50">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? 'bg-emerald-500' : 'bg-white/20'
        } ${disabled ? '' : 'hover:opacity-80'}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

interface ProviderDropdownProps {
  value: PreferredEncryptionProvider;
  onChange: (value: PreferredEncryptionProvider) => void;
  disabled?: boolean;
}

function ProviderDropdown({ value, onChange, disabled = false }: ProviderDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selectedOption = PROVIDER_OPTIONS.find((opt) => opt.value === value) || PROVIDER_OPTIONS[0];

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleSelect = (option: PreferredEncryptionProvider) => {
    onChange(option);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-white/60 uppercase tracking-wide">
        Preferred Provider
      </label>
      <div ref={containerRef} className="relative">
        {/* Trigger Button */}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`
            w-full flex items-center justify-between
            px-3 py-2.5
            bg-white/5 border border-white/10 rounded-lg
            text-sm font-light text-white
            transition-all duration-200
            ${disabled
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-white/10 hover:border-white/20 cursor-pointer'
            }
            ${isOpen ? 'border-white/20 bg-white/10' : ''}
            focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20
          `}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <span>{selectedOption.label}</span>
          <CaretDown
            size={14}
            weight="bold"
            className={`
              text-white/40 transition-transform duration-200
              ${isOpen ? 'rotate-180' : ''}
            `}
          />
        </button>

        {/* Dropdown Panel */}
        <div
          className={`
            absolute z-50 w-full mt-1
            bg-black border border-white/10 rounded-lg
            shadow-xl shadow-black/50
            overflow-hidden
            transition-all duration-200 origin-top
            ${isOpen
              ? 'opacity-100 scale-100 translate-y-0'
              : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
            }
          `}
          role="listbox"
          aria-label="Select encryption provider"
        >
          <div className="py-1">
            {PROVIDER_OPTIONS.map((option) => {
              const isSelected = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`
                    w-full flex items-center justify-between gap-3
                    px-3 py-2.5
                    text-sm font-light text-left
                    transition-colors duration-150
                    ${isSelected
                      ? 'bg-white/10 text-white'
                      : 'text-white/80 hover:bg-white/5 hover:text-white'
                    }
                    focus:outline-none focus:bg-white/10
                  `}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span>{option.label}</span>
                  {isSelected && (
                    <Check size={14} weight="bold" className="text-white/60" />
                  )}
                </button>
              );
            })}
          </div>
          {/* Subtle bottom accent line */}
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
      </div>
      <p className="text-xs text-white/40">{selectedOption.description}</p>
    </div>
  );
}

export function EncryptionSettings() {
  const {
    preferredEncryptionProvider,
    arciumEnabled,
    incoEnabled,
    autoFallbackEnabled,
    setPreferredEncryptionProvider,
    setArciumEnabled,
    setIncoEnabled,
    setAutoFallbackEnabled,
  } = useSettingsStore();

  const { provider, isProductionReady, keySource, isInitialized } = useUnifiedEncryption();

  // Check if admin override is active
  const hasForceOverride = !!ENV_FORCE_PROVIDER;

  // Determine status color
  const getStatusColor = () => {
    if (!isInitialized) return 'bg-white/20';
    if (isProductionReady) return 'bg-emerald-500';
    if (provider === 'demo') return 'bg-rose-500';
    return 'bg-yellow-500';
  };

  // Get provider display name
  const getProviderName = (p: string) => {
    switch (p) {
      case 'arcium':
        return 'Arcium MPC';
      case 'inco':
        return 'Inco TEE';
      case 'demo':
        return 'Demo Mode';
      default:
        return p;
    }
  };

  return (
    <div className="space-y-6">
      {/* Admin Override Warning */}
      {hasForceOverride && (
        <div className="flex items-start gap-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 p-4">
          <Warning className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" weight="fill" />
          <div>
            <div className="text-sm font-medium text-yellow-500">Admin Override Active</div>
            <div className="text-xs text-yellow-500/70 mt-1">
              Provider forced to <span className="font-mono">{ENV_FORCE_PROVIDER}</span> via
              environment variable. User settings are ignored.
            </div>
          </div>
        </div>
      )}

      {/* Current Status */}
      <div className="rounded-xl bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${getStatusColor()}`} />
            <div>
              <h3 className="text-sm font-medium text-white">Active Provider</h3>
              <div className="text-xs text-white/50 mt-0.5">
                {isInitialized ? (
                  <>
                    {getProviderName(provider)}
                    {keySource && keySource !== provider && (
                      <span className="text-white/30"> ({keySource})</span>
                    )}
                  </>
                ) : (
                  'Initializing...'
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isProductionReady ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">
                <Check size={12} weight="bold" />
                Production
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-1 text-xs text-yellow-400">
                <Warning size={12} weight="fill" />
                {provider === 'demo' ? 'Demo Only' : 'Testing'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Provider Preference Dropdown */}
      <ProviderDropdown
        value={preferredEncryptionProvider}
        onChange={setPreferredEncryptionProvider}
        disabled={hasForceOverride}
      />

      {/* Provider Info Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div
          className={`rounded-xl border p-3 ${
            provider === 'arcium'
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-white/10 bg-white/5'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <LockKey
              size={16}
              weight="fill"
              className={provider === 'arcium' ? 'text-emerald-400' : 'text-white/50'}
            />
            <span
              className={`text-xs font-medium ${provider === 'arcium' ? 'text-emerald-400' : 'text-white/70'}`}
            >
              Arcium
            </span>
          </div>
          <div className="text-xs text-white/50">
            {ENV_ARCIUM_ENABLED ? (
              arciumEnabled ? (
                'Enabled'
              ) : (
                'Disabled by user'
              )
            ) : (
              <span className="text-rose-400">Disabled by admin</span>
            )}
          </div>
        </div>

        <div
          className={`rounded-xl border p-3 ${
            provider === 'inco'
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-white/10 bg-white/5'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <Cloud
              size={16}
              weight="fill"
              className={provider === 'inco' ? 'text-emerald-400' : 'text-white/50'}
            />
            <span
              className={`text-xs font-medium ${provider === 'inco' ? 'text-emerald-400' : 'text-white/70'}`}
            >
              Inco
            </span>
          </div>
          <div className="text-xs text-white/50">
            {INCO_ENABLED ? (
              incoEnabled ? (
                'Enabled'
              ) : (
                'Disabled by user'
              )
            ) : (
              <span className="text-white/30">Not configured</span>
            )}
          </div>
        </div>
      </div>

      {/* Individual Toggles */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-white/60 uppercase tracking-wide">
          Provider Settings
        </label>
        <div className="space-y-2">
          <Toggle
            label="Enable Arcium MPC"
            description="Multi-party computation encryption"
            checked={arciumEnabled}
            onChange={setArciumEnabled}
            disabled={hasForceOverride || !ENV_ARCIUM_ENABLED}
          />
          <Toggle
            label="Enable Inco TEE"
            description="Trusted execution environment"
            checked={incoEnabled}
            onChange={setIncoEnabled}
            disabled={hasForceOverride || !INCO_ENABLED}
          />
          <Toggle
            label="Auto Fallback"
            description="Switch to backup if preferred unavailable"
            checked={autoFallbackEnabled}
            onChange={setAutoFallbackEnabled}
            disabled={hasForceOverride}
          />
        </div>
      </div>

      {/* Info Note */}
      <div className="flex items-start gap-2 rounded-lg bg-white/5 p-3">
        <Info size={14} className="text-white/40 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-white/40">
          Settings are saved locally and take effect immediately. Encryption keys and sensitive data
          are never stored in your browser.
        </p>
      </div>
    </div>
  );
}
