/**
 * Alerting System
 *
 * Multi-channel alerting with deduplication and severity levels.
 * Supports Slack, webhooks, and console output.
 */

// =============================================================================
// Types
// =============================================================================

export type AlertSeverity = 'critical' | 'error' | 'warning' | 'info';

export interface Alert {
  severity: AlertSeverity;
  title: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp: Date;
  dedupeKey?: string;
}

export interface AlertChannel {
  name: string;
  send(alert: Alert): Promise<void>;
}

export interface AlertManagerConfig {
  channels: AlertChannel[];
  dedupeWindowMs?: number;
  minSeverity?: AlertSeverity;
}

// =============================================================================
// Severity Utilities
// =============================================================================

const SEVERITY_LEVELS: Record<AlertSeverity, number> = {
  critical: 4,
  error: 3,
  warning: 2,
  info: 1,
};

export function severityToLevel(severity: AlertSeverity): number {
  return SEVERITY_LEVELS[severity];
}

export function shouldAlert(severity: AlertSeverity, minSeverity: AlertSeverity): boolean {
  return severityToLevel(severity) >= severityToLevel(minSeverity);
}

// =============================================================================
// Console Channel
// =============================================================================

export class ConsoleChannel implements AlertChannel {
  name = 'console';

  async send(alert: Alert): Promise<void> {
    const prefix = this.getSeverityPrefix(alert.severity);
    const timestamp = alert.timestamp.toISOString();
    const contextStr = alert.context ? ` | ${JSON.stringify(alert.context)}` : '';

    console.log(`${prefix} [${timestamp}] ${alert.title}: ${alert.message}${contextStr}`);
  }

  private getSeverityPrefix(severity: AlertSeverity): string {
    switch (severity) {
      case 'critical':
        return '🚨 CRITICAL';
      case 'error':
        return '❌ ERROR';
      case 'warning':
        return '⚠️ WARNING';
      case 'info':
        return 'ℹ️ INFO';
    }
  }
}

// =============================================================================
// Slack Channel
// =============================================================================

export interface SlackChannelConfig {
  webhookUrl: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

export class SlackChannel implements AlertChannel {
  name = 'slack';
  private config: SlackChannelConfig;
  private disabled: boolean = false;

  constructor(config: SlackChannelConfig) {
    this.config = config;
    // Disable if webhook URL is empty or a placeholder
    if (!config.webhookUrl ||
        config.webhookUrl.includes('YOUR/WEBHOOK') ||
        config.webhookUrl.includes('TXXXXX') ||
        !config.webhookUrl.startsWith('https://hooks.slack.com/')) {
      this.disabled = true;
      console.log('[SlackChannel] Disabled - no valid webhook URL configured');
    }
  }

  async send(alert: Alert): Promise<void> {
    if (this.disabled) {
      return; // Silently skip if disabled
    }

    const color = this.getSeverityColor(alert.severity);
    const emoji = this.getSeverityEmoji(alert.severity);

    const payload = {
      channel: this.config.channel,
      username: this.config.username || 'Confidex Alerts',
      icon_emoji: this.config.iconEmoji || ':robot_face:',
      attachments: [
        {
          color,
          title: `${emoji} ${alert.title}`,
          text: alert.message,
          fields: alert.context
            ? Object.entries(alert.context).map(([key, value]) => ({
                title: key,
                value: String(value),
                short: true,
              }))
            : [],
          ts: Math.floor(alert.timestamp.getTime() / 1000),
        },
      ],
    };

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`[SlackChannel] Failed to send alert: ${response.status}`);
      }
    } catch (error) {
      console.error('[SlackChannel] Error sending alert:', error);
    }
  }

  private getSeverityColor(severity: AlertSeverity): string {
    switch (severity) {
      case 'critical':
        return '#dc2626'; // red-600
      case 'error':
        return '#ea580c'; // orange-600
      case 'warning':
        return '#ca8a04'; // yellow-600
      case 'info':
        return '#2563eb'; // blue-600
    }
  }

  private getSeverityEmoji(severity: AlertSeverity): string {
    switch (severity) {
      case 'critical':
        return '🚨';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
    }
  }
}

// =============================================================================
// Webhook Channel
// =============================================================================

export interface WebhookChannelConfig {
  url: string;
  headers?: Record<string, string>;
  method?: 'POST' | 'PUT';
}

export class WebhookChannel implements AlertChannel {
  name = 'webhook';
  private config: WebhookChannelConfig;

  constructor(config: WebhookChannelConfig) {
    this.config = config;
  }

  async send(alert: Alert): Promise<void> {
    const payload = {
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      context: alert.context,
      timestamp: alert.timestamp.toISOString(),
    };

    try {
      const response = await fetch(this.config.url, {
        method: this.config.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`[WebhookChannel] Failed to send alert: ${response.status}`);
      }
    } catch (error) {
      console.error('[WebhookChannel] Error sending alert:', error);
    }
  }
}

// =============================================================================
// Alert Manager
// =============================================================================

export class AlertManager {
  private channels: AlertChannel[];
  private dedupeWindowMs: number;
  private minSeverity: AlertSeverity;
  private recentAlerts: Map<string, number> = new Map();

  constructor(config: AlertManagerConfig) {
    this.channels = config.channels;
    this.dedupeWindowMs = config.dedupeWindowMs ?? 60_000; // 1 minute default
    this.minSeverity = config.minSeverity ?? 'info';
  }

  /**
   * Send an alert to all configured channels
   */
  async alert(
    severity: AlertSeverity,
    title: string,
    message: string,
    context?: Record<string, unknown>,
    dedupeKey?: string
  ): Promise<boolean> {
    // Check minimum severity
    if (!shouldAlert(severity, this.minSeverity)) {
      return false;
    }

    // Check deduplication
    const key = dedupeKey || `${severity}:${title}`;
    if (this.isDuplicate(key)) {
      return false;
    }

    const alert: Alert = {
      severity,
      title,
      message,
      context,
      timestamp: new Date(),
      dedupeKey: key,
    };

    // Mark as sent
    this.markSent(key);

    // Send to all channels concurrently
    await Promise.allSettled(
      this.channels.map(channel =>
        channel.send(alert).catch(error => {
          console.error(`[AlertManager] Failed to send to ${channel.name}:`, error);
        })
      )
    );

    return true;
  }

  /**
   * Convenience methods for each severity level
   */
  async critical(
    title: string,
    message: string,
    context?: Record<string, unknown>,
    dedupeKey?: string
  ): Promise<boolean> {
    return this.alert('critical', title, message, context, dedupeKey);
  }

  async error(
    title: string,
    message: string,
    context?: Record<string, unknown>,
    dedupeKey?: string
  ): Promise<boolean> {
    return this.alert('error', title, message, context, dedupeKey);
  }

  async warning(
    title: string,
    message: string,
    context?: Record<string, unknown>,
    dedupeKey?: string
  ): Promise<boolean> {
    return this.alert('warning', title, message, context, dedupeKey);
  }

  async info(
    title: string,
    message: string,
    context?: Record<string, unknown>,
    dedupeKey?: string
  ): Promise<boolean> {
    return this.alert('info', title, message, context, dedupeKey);
  }

  /**
   * Check if an alert with this key was recently sent
   */
  private isDuplicate(key: string): boolean {
    const lastSent = this.recentAlerts.get(key);
    if (!lastSent) return false;

    const now = Date.now();
    return now - lastSent < this.dedupeWindowMs;
  }

  /**
   * Mark an alert as sent
   */
  private markSent(key: string): void {
    this.recentAlerts.set(key, Date.now());
    this.cleanupOldAlerts();
  }

  /**
   * Clean up expired deduplication entries
   */
  private cleanupOldAlerts(): void {
    const now = Date.now();
    const cutoff = now - this.dedupeWindowMs * 2;

    for (const [key, timestamp] of this.recentAlerts.entries()) {
      if (timestamp < cutoff) {
        this.recentAlerts.delete(key);
      }
    }
  }

  /**
   * Add a channel at runtime
   */
  addChannel(channel: AlertChannel): void {
    this.channels.push(channel);
  }

  /**
   * Remove a channel by name
   */
  removeChannel(name: string): void {
    this.channels = this.channels.filter(c => c.name !== name);
  }

  /**
   * Get all channel names
   */
  getChannelNames(): string[] {
    return this.channels.map(c => c.name);
  }
}

// =============================================================================
// Singleton Factory
// =============================================================================

let alertManagerInstance: AlertManager | null = null;

export interface AlertManagerEnvConfig {
  slackWebhookUrl?: string;
  slackChannel?: string;
  webhookUrl?: string;
  webhookHeaders?: Record<string, string>;
  dedupeWindowMs?: number;
  minSeverity?: AlertSeverity;
  enableConsole?: boolean;
}

/**
 * Get or create the singleton AlertManager instance
 */
export function getAlertManager(config?: AlertManagerEnvConfig): AlertManager {
  if (alertManagerInstance) {
    return alertManagerInstance;
  }

  const channels: AlertChannel[] = [];

  // Console channel (default enabled)
  if (config?.enableConsole !== false) {
    channels.push(new ConsoleChannel());
  }

  // Slack channel - only add if URL looks valid
  if (config?.slackWebhookUrl &&
      config.slackWebhookUrl.startsWith('https://hooks.slack.com/') &&
      !config.slackWebhookUrl.includes('YOUR/WEBHOOK') &&
      !config.slackWebhookUrl.includes('TXXXXX')) {
    channels.push(
      new SlackChannel({
        webhookUrl: config.slackWebhookUrl,
        channel: config.slackChannel,
      })
    );
  } else if (config?.slackWebhookUrl) {
    console.log('[AlertManager] Slack disabled - webhook URL appears to be a placeholder');
  }

  // Webhook channel
  if (config?.webhookUrl) {
    channels.push(
      new WebhookChannel({
        url: config.webhookUrl,
        headers: config.webhookHeaders,
      })
    );
  }

  alertManagerInstance = new AlertManager({
    channels,
    dedupeWindowMs: config?.dedupeWindowMs,
    minSeverity: config?.minSeverity,
  });

  return alertManagerInstance;
}

/**
 * Initialize AlertManager from environment variables
 */
export function initAlertManagerFromEnv(): AlertManager {
  return getAlertManager({
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    slackChannel: process.env.SLACK_ALERT_CHANNEL,
    webhookUrl: process.env.ALERT_WEBHOOK_URL,
    dedupeWindowMs: process.env.ALERT_DEDUPE_WINDOW_MS
      ? parseInt(process.env.ALERT_DEDUPE_WINDOW_MS, 10)
      : undefined,
    minSeverity: (process.env.ALERT_MIN_SEVERITY as AlertSeverity) || undefined,
    enableConsole: process.env.ALERT_ENABLE_CONSOLE !== 'false',
  });
}

/**
 * Reset the singleton (for testing)
 */
export function resetAlertManager(): void {
  alertManagerInstance = null;
}
