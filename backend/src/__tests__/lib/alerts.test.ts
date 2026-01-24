import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AlertManager,
  ConsoleChannel,
  SlackChannel,
  WebhookChannel,
  AlertSeverity,
  Alert,
  severityToLevel,
  shouldAlert,
  getAlertManager,
  resetAlertManager,
  initAlertManagerFromEnv,
} from '../../lib/alerts.js';

describe('AlertManager', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {}) as any;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resetAlertManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('severity utilities', () => {
    it('converts severity to numeric level', () => {
      expect(severityToLevel('critical')).toBe(4);
      expect(severityToLevel('error')).toBe(3);
      expect(severityToLevel('warning')).toBe(2);
      expect(severityToLevel('info')).toBe(1);
    });

    it('correctly determines if alert should be sent based on min severity', () => {
      expect(shouldAlert('critical', 'info')).toBe(true);
      expect(shouldAlert('error', 'info')).toBe(true);
      expect(shouldAlert('warning', 'error')).toBe(false);
      expect(shouldAlert('info', 'warning')).toBe(false);
      expect(shouldAlert('critical', 'critical')).toBe(true);
    });
  });

  describe('ConsoleChannel', () => {
    it('formats alerts with severity prefix', async () => {
      const channel = new ConsoleChannel();

      await channel.send({
        severity: 'critical',
        title: 'Test Alert',
        message: 'This is a test',
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Test Alert')
      );
    });

    it('includes context in output', async () => {
      const channel = new ConsoleChannel();

      await channel.send({
        severity: 'error',
        title: 'Error Alert',
        message: 'Something went wrong',
        context: { userId: 123, action: 'test' },
        timestamp: new Date(),
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('userId')
      );
    });
  });

  describe('SlackChannel', () => {
    it('sends alert to Slack webhook', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      const channel = new SlackChannel({
        webhookUrl: 'https://hooks.slack.com/test',
        channel: '#alerts',
      });

      await channel.send({
        severity: 'warning',
        title: 'Warning Alert',
        message: 'Something to watch',
        timestamp: new Date(),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.channel).toBe('#alerts');
      expect(payload.attachments[0].title).toContain('Warning Alert');
    });

    it('handles fetch errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const channel = new SlackChannel({
        webhookUrl: 'https://hooks.slack.com/test',
      });

      // Should not throw
      await channel.send({
        severity: 'error',
        title: 'Error',
        message: 'Test',
        timestamp: new Date(),
      });
    });
  });

  describe('WebhookChannel', () => {
    it('sends alert to custom webhook', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      const channel = new WebhookChannel({
        url: 'https://api.example.com/alerts',
        headers: { Authorization: 'Bearer token' },
      });

      await channel.send({
        severity: 'info',
        title: 'Info Alert',
        message: 'FYI',
        timestamp: new Date(),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/alerts',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token',
          }),
        })
      );
    });
  });

  describe('AlertManager', () => {
    it('sends alerts to all channels', async () => {
      const mockChannel1 = { name: 'mock1', send: vi.fn().mockResolvedValue(undefined) };
      const mockChannel2 = { name: 'mock2', send: vi.fn().mockResolvedValue(undefined) };

      const manager = new AlertManager({
        channels: [mockChannel1, mockChannel2],
      });

      await manager.alert('error', 'Test', 'Message');

      expect(mockChannel1.send).toHaveBeenCalledTimes(1);
      expect(mockChannel2.send).toHaveBeenCalledTimes(1);
    });

    it('respects minimum severity', async () => {
      const mockChannel = { name: 'mock', send: vi.fn().mockResolvedValue(undefined) };

      const manager = new AlertManager({
        channels: [mockChannel],
        minSeverity: 'warning',
      });

      // Info should be filtered
      await manager.info('Test', 'Message');
      expect(mockChannel.send).not.toHaveBeenCalled();

      // Warning should pass
      await manager.warning('Test', 'Message');
      expect(mockChannel.send).toHaveBeenCalledTimes(1);
    });

    it('deduplicates alerts within window', async () => {
      const mockChannel = { name: 'mock', send: vi.fn().mockResolvedValue(undefined) };

      const manager = new AlertManager({
        channels: [mockChannel],
        dedupeWindowMs: 60_000,
      });

      // First alert should send
      await manager.alert('error', 'Test', 'Message', {}, 'dedupe-key');
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      // Duplicate should be skipped
      await manager.alert('error', 'Test', 'Message', {}, 'dedupe-key');
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      // Different key should send
      await manager.alert('error', 'Test', 'Message', {}, 'different-key');
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
    });

    it('provides convenience methods for each severity', async () => {
      const mockChannel = { name: 'mock', send: vi.fn().mockResolvedValue(undefined) };

      const manager = new AlertManager({
        channels: [mockChannel],
      });

      await manager.critical('Title', 'Message');
      expect(mockChannel.send).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: 'critical' })
      );

      await manager.error('Title', 'Message');
      expect(mockChannel.send).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: 'error' })
      );

      await manager.warning('Title', 'Message');
      expect(mockChannel.send).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: 'warning' })
      );

      await manager.info('Title', 'Message');
      expect(mockChannel.send).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: 'info' })
      );
    });

    it('can add and remove channels', () => {
      const manager = new AlertManager({ channels: [] });

      expect(manager.getChannelNames()).toEqual([]);

      manager.addChannel({ name: 'test', send: vi.fn() });
      expect(manager.getChannelNames()).toContain('test');

      manager.removeChannel('test');
      expect(manager.getChannelNames()).not.toContain('test');
    });
  });

  describe('getAlertManager', () => {
    it('returns singleton instance', () => {
      const manager1 = getAlertManager({ enableConsole: true });
      const manager2 = getAlertManager();

      expect(manager1).toBe(manager2);
    });

    it('creates console channel by default', () => {
      const manager = getAlertManager({ enableConsole: true });
      expect(manager.getChannelNames()).toContain('console');
    });

    it('creates Slack channel when webhook URL provided', () => {
      resetAlertManager();
      const manager = getAlertManager({
        slackWebhookUrl: 'https://hooks.slack.com/test',
        enableConsole: false,
      });
      expect(manager.getChannelNames()).toContain('slack');
    });

    it('creates webhook channel when URL provided', () => {
      resetAlertManager();
      const manager = getAlertManager({
        webhookUrl: 'https://api.example.com/alerts',
        enableConsole: false,
      });
      expect(manager.getChannelNames()).toContain('webhook');
    });
  });

  describe('initAlertManagerFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      resetAlertManager();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('creates manager with Slack channel from environment', () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test-env';
      process.env.SLACK_ALERT_CHANNEL = '#env-channel';

      const manager = initAlertManagerFromEnv();

      expect(manager.getChannelNames()).toContain('slack');
    });

    it('creates manager with webhook channel from environment', () => {
      resetAlertManager();
      process.env.ALERT_WEBHOOK_URL = 'https://api.example.com/env-alerts';
      delete process.env.SLACK_WEBHOOK_URL;

      const manager = initAlertManagerFromEnv();

      expect(manager.getChannelNames()).toContain('webhook');
    });

    it('parses dedupe window from environment', () => {
      resetAlertManager();
      process.env.ALERT_DEDUPE_WINDOW_MS = '30000';
      delete process.env.SLACK_WEBHOOK_URL;
      delete process.env.ALERT_WEBHOOK_URL;

      const manager = initAlertManagerFromEnv();

      // Verify manager was created (dedupe window is internal)
      expect(manager).toBeDefined();
    });

    it('sets min severity from environment', () => {
      resetAlertManager();
      process.env.ALERT_MIN_SEVERITY = 'warning';
      delete process.env.SLACK_WEBHOOK_URL;
      delete process.env.ALERT_WEBHOOK_URL;

      const manager = initAlertManagerFromEnv();

      expect(manager).toBeDefined();
    });

    it('disables console when ALERT_ENABLE_CONSOLE is false', () => {
      resetAlertManager();
      process.env.ALERT_ENABLE_CONSOLE = 'false';
      delete process.env.SLACK_WEBHOOK_URL;
      delete process.env.ALERT_WEBHOOK_URL;

      const manager = initAlertManagerFromEnv();

      expect(manager.getChannelNames()).not.toContain('console');
    });

    it('enables console by default', () => {
      resetAlertManager();
      delete process.env.ALERT_ENABLE_CONSOLE;
      delete process.env.SLACK_WEBHOOK_URL;
      delete process.env.ALERT_WEBHOOK_URL;

      const manager = initAlertManagerFromEnv();

      expect(manager.getChannelNames()).toContain('console');
    });
  });

  describe('cleanupOldAlerts', () => {
    it('removes expired dedupe entries after sending alerts', async () => {
      vi.useFakeTimers();
      const mockChannel = { name: 'mock', send: vi.fn().mockResolvedValue(undefined) };

      const manager = new AlertManager({
        channels: [mockChannel],
        dedupeWindowMs: 1000, // 1 second for testing
      });

      // Send first alert
      await manager.alert('error', 'Test', 'Message 1', {}, 'cleanup-test');
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      // Same key should be deduplicated
      await manager.alert('error', 'Test', 'Message 2', {}, 'cleanup-test');
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      // Advance time beyond 2x dedupe window to trigger cleanup
      vi.advanceTimersByTime(2500); // 2.5 seconds

      // Send another alert to trigger cleanup of old entries
      await manager.alert('error', 'Other', 'Message 3', {}, 'different-key');
      expect(mockChannel.send).toHaveBeenCalledTimes(2);

      // Now the old key should be cleaned up, so sending again should work
      await manager.alert('error', 'Test', 'Message 4', {}, 'cleanup-test');
      expect(mockChannel.send).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('cleans up multiple expired entries', async () => {
      vi.useFakeTimers();
      const mockChannel = { name: 'mock', send: vi.fn().mockResolvedValue(undefined) };

      const manager = new AlertManager({
        channels: [mockChannel],
        dedupeWindowMs: 500,
      });

      // Send multiple alerts with different keys
      await manager.alert('error', 'Test1', 'Message', {}, 'key1');
      await manager.alert('error', 'Test2', 'Message', {}, 'key2');
      await manager.alert('error', 'Test3', 'Message', {}, 'key3');
      expect(mockChannel.send).toHaveBeenCalledTimes(3);

      // Advance time beyond cleanup threshold (2x dedupe window)
      vi.advanceTimersByTime(1500);

      // Trigger cleanup by sending new alert
      await manager.alert('error', 'New', 'Message', {}, 'newkey');
      expect(mockChannel.send).toHaveBeenCalledTimes(4);

      // All old keys should now be cleaned up
      await manager.alert('error', 'Test1', 'Message', {}, 'key1');
      await manager.alert('error', 'Test2', 'Message', {}, 'key2');
      await manager.alert('error', 'Test3', 'Message', {}, 'key3');
      expect(mockChannel.send).toHaveBeenCalledTimes(7);

      vi.useRealTimers();
    });
  });

  describe('SlackChannel additional coverage', () => {
    it('handles non-ok response from Slack', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      global.fetch = mockFetch;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const channel = new SlackChannel({
        webhookUrl: 'https://hooks.slack.com/test',
      });

      await channel.send({
        severity: 'critical',
        title: 'Test',
        message: 'Message',
        timestamp: new Date(),
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SlackChannel] Failed to send alert: 500')
      );
    });

    it('formats alert with all severity colors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      const channel = new SlackChannel({
        webhookUrl: 'https://hooks.slack.com/test',
        username: 'Test Bot',
        iconEmoji: ':test:',
      });

      const severities: AlertSeverity[] = ['critical', 'error', 'warning', 'info'];

      for (const severity of severities) {
        await channel.send({
          severity,
          title: `${severity} Alert`,
          message: 'Test message',
          context: { key: 'value' },
          timestamp: new Date(),
        });
      }

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('WebhookChannel additional coverage', () => {
    it('handles non-ok response from webhook', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      global.fetch = mockFetch;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const channel = new WebhookChannel({
        url: 'https://api.example.com/alerts',
      });

      await channel.send({
        severity: 'error',
        title: 'Test',
        message: 'Message',
        timestamp: new Date(),
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebhookChannel] Failed to send alert: 503')
      );
    });

    it('handles fetch error from webhook', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const channel = new WebhookChannel({
        url: 'https://api.example.com/alerts',
      });

      await channel.send({
        severity: 'warning',
        title: 'Test',
        message: 'Message',
        timestamp: new Date(),
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[WebhookChannel] Error sending alert:',
        expect.any(Error)
      );
    });

    it('uses PUT method when specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      const channel = new WebhookChannel({
        url: 'https://api.example.com/alerts',
        method: 'PUT',
      });

      await channel.send({
        severity: 'info',
        title: 'Test',
        message: 'Message',
        timestamp: new Date(),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/alerts',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });
  });

  describe('ConsoleChannel severity formats', () => {
    it('formats warning severity correctly', async () => {
      const channel = new ConsoleChannel();

      await channel.send({
        severity: 'warning',
        title: 'Warning Alert',
        message: 'This is a warning',
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('WARNING')
      );
    });

    it('formats info severity correctly', async () => {
      const channel = new ConsoleChannel();

      await channel.send({
        severity: 'info',
        title: 'Info Alert',
        message: 'This is informational',
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('INFO')
      );
    });
  });

  describe('AlertManager channel failure handling', () => {
    it('continues sending to other channels when one fails', async () => {
      const failingChannel = {
        name: 'failing',
        send: vi.fn().mockRejectedValue(new Error('Channel failed')),
      };
      const workingChannel = {
        name: 'working',
        send: vi.fn().mockResolvedValue(undefined),
      };

      const manager = new AlertManager({
        channels: [failingChannel, workingChannel],
      });

      await manager.alert('error', 'Test', 'Message');

      expect(failingChannel.send).toHaveBeenCalledTimes(1);
      expect(workingChannel.send).toHaveBeenCalledTimes(1);
    });
  });
});
