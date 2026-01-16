'use client';

import { FC } from 'react';
import {
  Settings,
  Sliders,
  Bell,
  Shield,
  Moon,
  Sun,
  Monitor,
  ChevronRight,
  Info,
  X,
  Zap,
  Check,
  Clock,
} from 'lucide-react';
import { useThemeStore, Theme } from '@/stores/theme-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSettlementSelector } from '@/hooks/use-unified-settlement';
import type { SettlementMethod } from '@/lib/settlement';
import { ToggleSwitch } from './ui/toggle-switch';

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

const SettingsSection: FC<SettingsSectionProps> = ({ title, children }) => (
  <div className="mb-6">
    <h4 className="text-sm font-medium text-muted-foreground mb-3">{title}</h4>
    <div className="space-y-3">{children}</div>
  </div>
);

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const Toggle: FC<ToggleProps> = ({ label, description, checked, onChange }) => (
  <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
    <div>
      <div className="text-sm font-medium">{label}</div>
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
    </div>
    <ToggleSwitch checked={checked} onChange={onChange} />
  </div>
);

export const SettingsPanel: FC<{ onClose: () => void }> = ({ onClose }) => {
  const { theme, setTheme } = useThemeStore();
  const {
    slippage,
    setSlippage,
    autoWrap,
    setAutoWrap,
    confirmTx,
    setConfirmTx,
    privacyMode,
    setPrivacyMode,
    notifications,
    setNotifications,
    showSettlementFees,
    setShowSettlementFees,
  } = useSettingsStore();

  const {
    currentMethod,
    setMethod,
    allMethods,
    getMethodStatus,
  } = useSettlementSelector();

  const slippageOptions = ['0.1', '0.5', '1.0', '2.0'];

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative bg-card border border-border rounded-lg w-full max-w-md mx-4 max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Trading Settings */}
          <SettingsSection title="Trading">
            {/* Slippage */}
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Slippage Tolerance</span>
                </div>
                <div className="text-sm text-primary font-mono">{slippage}%</div>
              </div>
              <div className="flex gap-2">
                {slippageOptions.map((option) => (
                  <button
                    key={option}
                    onClick={() => setSlippage(option)}
                    className={`flex-1 py-1.5 text-xs rounded transition-colors ${
                      slippage === option
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-secondary'
                    }`}
                  >
                    {option}%
                  </button>
                ))}
                <input
                  type="number"
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  placeholder="Custom"
                  className="w-16 px-2 py-1.5 text-xs bg-background rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                  step="0.1"
                  min="0"
                  max="50"
                />
              </div>
            </div>

            <Toggle
              label="Auto-wrap tokens"
              description="Automatically wrap tokens when placing orders"
              checked={autoWrap}
              onChange={setAutoWrap}
            />

            <Toggle
              label="Confirm transactions"
              description="Show confirmation dialog before signing"
              checked={confirmTx}
              onChange={setConfirmTx}
            />
          </SettingsSection>

          {/* Settlement Settings */}
          <SettingsSection title="Settlement">
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Settlement Method</span>
              </div>
              <div className="space-y-2">
                {/* Auto option */}
                <button
                  onClick={() => setMethod('auto')}
                  className={`w-full p-3 rounded-lg text-left transition-colors ${
                    currentMethod === 'auto'
                      ? 'bg-primary/20 border border-primary'
                      : 'bg-background hover:bg-secondary border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium flex items-center gap-2">
                        Auto
                        {currentMethod === 'auto' && (
                          <Check className="h-3 w-3 text-primary" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Automatically select best available
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Recommended
                    </div>
                  </div>
                </button>

                {/* Individual methods */}
                {allMethods.map((method) => {
                  const status = getMethodStatus(method.id);
                  const isDisabled = !method.isAvailable;

                  return (
                    <button
                      key={method.id}
                      onClick={() => !isDisabled && setMethod(method.id)}
                      disabled={isDisabled}
                      className={`w-full p-3 rounded-lg text-left transition-colors ${
                        currentMethod === method.id
                          ? 'bg-primary/20 border border-primary'
                          : isDisabled
                          ? 'bg-muted/30 border border-transparent cursor-not-allowed opacity-60'
                          : 'bg-background hover:bg-secondary border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium flex items-center gap-2">
                            {method.name}
                            {currentMethod === method.id && (
                              <Check className="h-3 w-3 text-primary" />
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {method.description}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-mono">
                            {method.feeBps > 0
                              ? `${method.feeBps / 100}% fee`
                              : 'No fee'}
                          </div>
                          <div
                            className={`text-xs flex items-center gap-1 justify-end ${
                              method.isAvailable
                                ? 'text-white'
                                : 'text-white/60'
                            }`}
                          >
                            {method.isAvailable ? (
                              <>
                                <Check className="h-3 w-3" />
                                Available
                              </>
                            ) : (
                              <>
                                <Clock className="h-3 w-3" />
                                Coming Soon
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <Toggle
              label="Show settlement fees"
              description="Display fees in order preview"
              checked={showSettlementFees}
              onChange={setShowSettlementFees}
            />
          </SettingsSection>

          {/* Privacy Settings */}
          <SettingsSection title="Privacy">
            <Toggle
              label="Privacy mode"
              description="Hide balances by default"
              checked={privacyMode}
              onChange={setPrivacyMode}
            />

            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Encryption Status</span>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="flex items-center justify-between">
                  <span>Arcium MPC</span>
                  <span className="text-white">Active</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>ZK Proofs</span>
                  <span className="text-white">Enabled</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>C-SPL Tokens</span>
                  <span className="text-white/60">Pending</span>
                </div>
              </div>
            </div>
          </SettingsSection>

          {/* Appearance */}
          <SettingsSection title="Appearance">
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="text-sm font-medium mb-2">Theme</div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleThemeChange('dark')}
                  className={`flex-1 py-2 rounded flex items-center justify-center gap-1 transition-colors ${
                    theme === 'dark'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-secondary'
                  }`}
                >
                  <Moon className="h-4 w-4" />
                  <span className="text-xs">Dark</span>
                </button>
                <button
                  onClick={() => handleThemeChange('light')}
                  className={`flex-1 py-2 rounded flex items-center justify-center gap-1 transition-colors ${
                    theme === 'light'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-secondary'
                  }`}
                >
                  <Sun className="h-4 w-4" />
                  <span className="text-xs">Light</span>
                </button>
                <button
                  onClick={() => handleThemeChange('system')}
                  className={`flex-1 py-2 rounded flex items-center justify-center gap-1 transition-colors ${
                    theme === 'system'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-secondary'
                  }`}
                >
                  <Monitor className="h-4 w-4" />
                  <span className="text-xs">System</span>
                </button>
              </div>
            </div>
          </SettingsSection>

          {/* Notifications */}
          <SettingsSection title="Notifications">
            <Toggle
              label="Order updates"
              description="Get notified when orders fill or cancel"
              checked={notifications}
              onChange={setNotifications}
            />
          </SettingsSection>

          {/* Info */}
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground mb-1">
                  Confidex v0.1.0 (Devnet)
                </p>
                <p>
                  Settings are stored locally in your browser. Privacy-preserving
                  trading powered by Arcium MPC and Noir ZK proofs.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
