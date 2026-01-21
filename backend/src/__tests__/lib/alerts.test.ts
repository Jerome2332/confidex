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
});
