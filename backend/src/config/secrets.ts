/**
 * Secret Provider Abstraction
 *
 * Supports multiple secret backends:
 * - Environment variables (default, development)
 * - AWS Secrets Manager (production)
 * - HashiCorp Vault (production)
 *
 * Features:
 * - Lazy loading with caching
 * - Hot-reload support (via callbacks)
 * - Secret expiry monitoring
 * - Audit logging
 */

import { EventEmitter } from 'events';
import { createLogger } from '../lib/logger.js';

const log = createLogger('secrets');

// =============================================================================
// Types
// =============================================================================

export interface SecretMetadata {
  /** When the secret was last loaded */
  loadedAt: Date;
  /** When the secret expires (if applicable) */
  expiresAt?: Date;
  /** Source of the secret */
  source: 'env' | 'aws' | 'vault' | 'file';
  /** Version identifier (if applicable) */
  version?: string;
}

export interface SecretWithMetadata {
  value: string;
  metadata: SecretMetadata;
}

export interface SecretProvider {
  /** Get a secret value by key */
  getSecret(key: string): Promise<string | undefined>;

  /** Get secret with metadata */
  getSecretWithMetadata(key: string): Promise<SecretWithMetadata | undefined>;

  /** Check if a secret exists */
  hasSecret(key: string): Promise<boolean>;

  /** Register callback for secret changes (hot-reload) */
  onSecretChanged(key: string, callback: (value: string) => void): void;

  /** Get the provider name */
  readonly name: string;
}

// =============================================================================
// Environment Secret Provider
// =============================================================================

/**
 * Simple secret provider that reads from environment variables.
 * Suitable for development and simple deployments.
 */
export class EnvSecretProvider implements SecretProvider {
  readonly name = 'env';
  private cache = new Map<string, SecretWithMetadata>();

  async getSecret(key: string): Promise<string | undefined> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached) {
      return cached.value;
    }

    const value = process.env[key];
    if (value) {
      this.cache.set(key, {
        value,
        metadata: {
          loadedAt: new Date(),
          source: 'env',
        },
      });
    }
    return value;
  }

  async getSecretWithMetadata(key: string): Promise<SecretWithMetadata | undefined> {
    await this.getSecret(key); // Populate cache
    return this.cache.get(key);
  }

  async hasSecret(key: string): Promise<boolean> {
    return process.env[key] !== undefined;
  }

  onSecretChanged(_key: string, _callback: (value: string) => void): void {
    // Environment variables don't support hot-reload
    log.debug('Secret change notifications not supported for env provider');
  }
}

// =============================================================================
// AWS Secrets Manager Provider (Placeholder)
// =============================================================================

export interface AwsSecretsManagerConfig {
  region: string;
  secretsPrefix?: string;
  cacheTimeMs?: number;
}

/**
 * Secret provider that reads from AWS Secrets Manager.
 * Supports hot-reload via polling or Lambda extensions.
 */
export class AwsSecretsManagerProvider implements SecretProvider {
  readonly name = 'aws';
  private config: AwsSecretsManagerConfig;
  private cache = new Map<string, SecretWithMetadata>();
  private callbacks = new Map<string, Set<(value: string) => void>>();
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(config: AwsSecretsManagerConfig) {
    this.config = {
      cacheTimeMs: 5 * 60 * 1000, // 5 minutes default cache
      ...config,
    };
  }

  async getSecret(key: string): Promise<string | undefined> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && this.isCacheValid(cached)) {
      return cached.value;
    }

    try {
      // TODO: Implement AWS SDK call
      // const client = new SecretsManagerClient({ region: this.config.region });
      // const command = new GetSecretValueCommand({
      //   SecretId: `${this.config.secretsPrefix || ''}${key}`,
      // });
      // const response = await client.send(command);
      // const value = response.SecretString;

      // For now, fall back to environment variable
      const value = process.env[key];

      if (value) {
        this.cache.set(key, {
          value,
          metadata: {
            loadedAt: new Date(),
            expiresAt: new Date(Date.now() + (this.config.cacheTimeMs || 300000)),
            source: 'aws',
          },
        });
      }

      return value;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ key, error: errMsg }, 'Failed to fetch secret from AWS');
      // Fall back to cached value if available
      return cached?.value;
    }
  }

  async getSecretWithMetadata(key: string): Promise<SecretWithMetadata | undefined> {
    await this.getSecret(key);
    return this.cache.get(key);
  }

  async hasSecret(key: string): Promise<boolean> {
    const value = await this.getSecret(key);
    return value !== undefined;
  }

  onSecretChanged(key: string, callback: (value: string) => void): void {
    if (!this.callbacks.has(key)) {
      this.callbacks.set(key, new Set());
    }
    this.callbacks.get(key)!.add(callback);

    // Start polling if not already running
    this.startPolling();
  }

  private isCacheValid(cached: SecretWithMetadata): boolean {
    if (!cached.metadata.expiresAt) return true;
    return new Date() < cached.metadata.expiresAt;
  }

  private startPolling(): void {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(async () => {
      for (const [key, callbacks] of this.callbacks.entries()) {
        try {
          const oldValue = this.cache.get(key)?.value;
          // Clear cache to force refresh
          this.cache.delete(key);
          const newValue = await this.getSecret(key);

          if (newValue && newValue !== oldValue) {
            log.info({ key }, 'Secret changed, notifying listeners');
            callbacks.forEach((cb) => cb(newValue));
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.error({ key, error: errMsg }, 'Error polling for secret changes');
        }
      }
    }, 60000); // Poll every minute

    this.pollingInterval.unref?.();
  }

  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

// =============================================================================
// HashiCorp Vault Provider (Placeholder)
// =============================================================================

export interface VaultConfig {
  address: string;
  token?: string;
  namespace?: string;
  secretsPath?: string;
  cacheTimeMs?: number;
}

/**
 * Secret provider that reads from HashiCorp Vault.
 * Supports automatic token renewal and hot-reload.
 */
export class VaultSecretProvider implements SecretProvider {
  readonly name = 'vault';
  private config: VaultConfig;
  private cache = new Map<string, SecretWithMetadata>();
  private callbacks = new Map<string, Set<(value: string) => void>>();

  constructor(config: VaultConfig) {
    this.config = {
      secretsPath: 'secret/data/',
      cacheTimeMs: 5 * 60 * 1000,
      ...config,
    };
  }

  async getSecret(key: string): Promise<string | undefined> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && this.isCacheValid(cached)) {
      return cached.value;
    }

    try {
      // TODO: Implement Vault API call
      // const response = await fetch(
      //   `${this.config.address}/v1/${this.config.secretsPath}${key}`,
      //   {
      //     headers: {
      //       'X-Vault-Token': this.config.token || '',
      //       'X-Vault-Namespace': this.config.namespace || '',
      //     },
      //   }
      // );
      // const data = await response.json();
      // const value = data.data?.data?.value;

      // For now, fall back to environment variable
      const value = process.env[key];

      if (value) {
        this.cache.set(key, {
          value,
          metadata: {
            loadedAt: new Date(),
            expiresAt: new Date(Date.now() + (this.config.cacheTimeMs || 300000)),
            source: 'vault',
          },
        });
      }

      return value;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ key, error: errMsg }, 'Failed to fetch secret from Vault');
      return cached?.value;
    }
  }

  async getSecretWithMetadata(key: string): Promise<SecretWithMetadata | undefined> {
    await this.getSecret(key);
    return this.cache.get(key);
  }

  async hasSecret(key: string): Promise<boolean> {
    const value = await this.getSecret(key);
    return value !== undefined;
  }

  onSecretChanged(key: string, callback: (value: string) => void): void {
    if (!this.callbacks.has(key)) {
      this.callbacks.set(key, new Set());
    }
    this.callbacks.get(key)!.add(callback);
    // TODO: Implement Vault watch or polling
    log.debug({ key }, 'Registered secret change callback for Vault');
  }

  private isCacheValid(cached: SecretWithMetadata): boolean {
    if (!cached.metadata.expiresAt) return true;
    return new Date() < cached.metadata.expiresAt;
  }
}

// =============================================================================
// Secret Manager (Composite)
// =============================================================================

/**
 * Composite secret manager that supports multiple providers.
 * Tries providers in order until a secret is found.
 */
export class SecretManager extends EventEmitter {
  private providers: SecretProvider[] = [];
  private primaryProvider: SecretProvider;

  constructor(primaryProvider?: SecretProvider) {
    super();
    this.primaryProvider = primaryProvider || new EnvSecretProvider();
    this.providers.push(this.primaryProvider);
  }

  /**
   * Add a secret provider (checked in order after primary)
   */
  addProvider(provider: SecretProvider): void {
    this.providers.push(provider);
    log.info({ provider: provider.name }, 'Added secret provider');
  }

  /**
   * Get a secret from the first provider that has it
   */
  async getSecret(key: string): Promise<string | undefined> {
    for (const provider of this.providers) {
      try {
        const value = await provider.getSecret(key);
        if (value !== undefined) {
          return value;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn({ provider: provider.name, key, error: errMsg }, 'Provider failed');
        continue;
      }
    }
    return undefined;
  }

  /**
   * Get a secret with metadata
   */
  async getSecretWithMetadata(key: string): Promise<SecretWithMetadata | undefined> {
    for (const provider of this.providers) {
      try {
        const result = await provider.getSecretWithMetadata(key);
        if (result !== undefined) {
          return result;
        }
      } catch (err) {
        continue;
      }
    }
    return undefined;
  }

  /**
   * Get a required secret (throws if not found)
   */
  async getRequiredSecret(key: string): Promise<string> {
    const value = await this.getSecret(key);
    if (value === undefined) {
      throw new Error(`Required secret not found: ${key}`);
    }
    return value;
  }

  /**
   * Register callback for secret changes
   */
  onSecretChanged(key: string, callback: (value: string) => void): void {
    for (const provider of this.providers) {
      provider.onSecretChanged(key, callback);
    }
  }

  /**
   * List all provider names
   */
  getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

let _secretManager: SecretManager | null = null;

/**
 * Get or create the global secret manager
 */
export function getSecretManager(): SecretManager {
  if (!_secretManager) {
    _secretManager = createSecretManager();
  }
  return _secretManager;
}

/**
 * Create a secret manager based on environment configuration
 */
export function createSecretManager(): SecretManager {
  const env = process.env.NODE_ENV || 'development';

  // Always start with environment provider
  const manager = new SecretManager(new EnvSecretProvider());

  // Add production providers based on configuration
  if (env === 'production') {
    // AWS Secrets Manager
    if (process.env.AWS_REGION && process.env.USE_AWS_SECRETS === 'true') {
      manager.addProvider(
        new AwsSecretsManagerProvider({
          region: process.env.AWS_REGION,
          secretsPrefix: process.env.AWS_SECRETS_PREFIX,
        })
      );
    }

    // HashiCorp Vault
    if (process.env.VAULT_ADDR && process.env.VAULT_TOKEN) {
      manager.addProvider(
        new VaultSecretProvider({
          address: process.env.VAULT_ADDR,
          token: process.env.VAULT_TOKEN,
          namespace: process.env.VAULT_NAMESPACE,
        })
      );
    }
  }

  log.info({ providers: manager.getProviderNames() }, 'Secret manager initialized');
  return manager;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Get a secret using the global manager
 */
export async function getSecret(key: string): Promise<string | undefined> {
  return getSecretManager().getSecret(key);
}

/**
 * Get a required secret using the global manager
 */
export async function getRequiredSecret(key: string): Promise<string> {
  return getSecretManager().getRequiredSecret(key);
}
