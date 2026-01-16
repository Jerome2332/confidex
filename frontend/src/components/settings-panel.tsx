'use client';

import { FC, useState } from 'react';
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
} from 'lucide-react';
import { useThemeStore, Theme } from '@/stores/theme-store';

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
    <button
      onClick={() => onChange(!checked)}
      className={`w-10 h-5 rounded-full transition-colors relative ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <div
        className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  </div>
);

export const SettingsPanel: FC<{ onClose: () => void }> = ({ onClose }) => {
  const [slippage, setSlippage] = useState('0.5');
  const [notifications, setNotifications] = useState(true);
  const [autoWrap, setAutoWrap] = useState(true);
  const { theme, setTheme } = useThemeStore();
  const [confirmTx, setConfirmTx] = useState(true);
  const [privacyMode, setPrivacyMode] = useState(true);

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
                  <span className="text-green-400">Active</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>ZK Proofs</span>
                  <span className="text-green-400">Enabled</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>C-SPL Tokens</span>
                  <span className="text-yellow-400">Pending</span>
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
