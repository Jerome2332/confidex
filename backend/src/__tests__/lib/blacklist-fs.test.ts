/**
 * Blacklist SMT File System Edge Case Tests
 *
 * These tests specifically target the error handling paths in blacklist.ts
 * that require mocking the file system operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';

// Mock fs/promises and fs before importing the module
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
}));

// Mock the prover.js proofCache to avoid module loading issues
vi.mock('../../lib/prover.js', () => ({
  proofCache: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    invalidateByRoot: vi.fn(),
    stats: vi.fn().mockReturnValue({ size: 0, maxSize: 100 }),
  },
}));

describe('SparseMerkleTree file system edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: file doesn't exist
    mockExistsSync.mockReturnValue(false);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  describe('load() error handling', () => {
    it('handles JSON parse error gracefully (returns empty tree)', async () => {
      // File exists but contains invalid JSON
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue('not valid json {{{');

      // Import fresh module after mocks are set
      const { getMerkleRoot, _resetSMTForTesting, getEmptyTreeRoot } = await import(
        '../../lib/blacklist.js'
      );

      _resetSMTForTesting();

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const root = await getMerkleRoot();

      // Should return empty tree root since loading failed
      expect(root).toBe(getEmptyTreeRoot());

      // Should have logged a warning
      expect(consoleSpy).toHaveBeenCalledWith(
        '[blacklist] Failed to load blacklist from storage:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('handles readFile error gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockRejectedValue(new Error('Permission denied'));

      const { getMerkleRoot, _resetSMTForTesting, getEmptyTreeRoot } = await import(
        '../../lib/blacklist.js'
      );

      _resetSMTForTesting();

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const root = await getMerkleRoot();

      // Should return empty tree root since loading failed
      expect(root).toBe(getEmptyTreeRoot());

      expect(consoleSpy).toHaveBeenCalledWith(
        '[blacklist] Failed to load blacklist from storage:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('warns when stored merkleRoot differs from computed root', async () => {
      // Valid JSON with addresses and a WRONG merkle root
      const storageData = {
        addresses: ['BadActor1111111111111111111111111111111111111'],
        merkleRoot: '0x0000000000000000000000000000000000000000000000000000000000000001', // Wrong root
        lastUpdated: new Date().toISOString(),
        version: 1,
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify(storageData));

      const { getMerkleRoot, _resetSMTForTesting } = await import('../../lib/blacklist.js');

      _resetSMTForTesting();

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const root = await getMerkleRoot();

      // Should return the COMPUTED root (not the stored wrong one)
      expect(root).not.toBe(storageData.merkleRoot);
      expect(root).toMatch(/^0x[0-9a-f]{64}$/);

      // Should have logged a warning about root mismatch
      expect(consoleSpy).toHaveBeenCalledWith(
        '[blacklist] Stored root differs from computed root, using computed'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('save() error handling', () => {
    it('throws and logs error when mkdir fails', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdir.mockRejectedValue(new Error('Cannot create directory'));

      const { addToBlacklist, _resetSMTForTesting } = await import('../../lib/blacklist.js');

      _resetSMTForTesting();

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Adding to blacklist triggers save()
      await expect(
        addToBlacklist('TestAddr1111111111111111111111111111111111111')
      ).rejects.toThrow('Cannot create directory');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[blacklist] Failed to save blacklist to storage:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('throws and logs error when writeFile fails', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockRejectedValue(new Error('Disk full'));

      const { addToBlacklist, _resetSMTForTesting } = await import('../../lib/blacklist.js');

      _resetSMTForTesting();

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        addToBlacklist('TestAddr2111111111111111111111111111111111111')
      ).rejects.toThrow('Disk full');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[blacklist] Failed to save blacklist to storage:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
