import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { CrankWallet, generateCrankWallet } from '../../crank/crank-wallet.js';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock Connection
const mockConnection = {
  getBalance: vi.fn(),
} as unknown as Connection;

describe('CrankWallet', () => {
  let wallet: CrankWallet;
  let testKeypair: Keypair;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    delete process.env.CRANK_WALLET_SECRET_KEY;

    // Generate a test keypair
    testKeypair = Keypair.generate();

    // Default mock: wallet file doesn't exist
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    wallet = new CrankWallet(mockConnection, './test-wallet.json', 0.1);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('load', () => {
    describe('from environment variable', () => {
      it('loads keypair from JSON array in env var', async () => {
        const secretKeyArray = Array.from(testKeypair.secretKey);
        process.env.CRANK_WALLET_SECRET_KEY = JSON.stringify(secretKeyArray);

        await wallet.load();

        expect(wallet.getPublicKey().toBase58()).toBe(testKeypair.publicKey.toBase58());
      });

      it('loads keypair from base58 string in env var', async () => {
        const base58Key = bs58.encode(testKeypair.secretKey);
        process.env.CRANK_WALLET_SECRET_KEY = base58Key;

        await wallet.load();

        expect(wallet.getPublicKey().toBase58()).toBe(testKeypair.publicKey.toBase58());
      });

      it('throws error for invalid JSON array length', async () => {
        process.env.CRANK_WALLET_SECRET_KEY = JSON.stringify([1, 2, 3]); // Only 3 bytes

        await expect(wallet.load()).rejects.toThrow('JSON secret key must be an array of 64 bytes');
      });

      it('throws error for invalid base58 string', async () => {
        process.env.CRANK_WALLET_SECRET_KEY = 'invalidbase58!!!';

        await expect(wallet.load()).rejects.toThrow('Failed to parse CRANK_WALLET_SECRET_KEY');
      });

      it('throws error for base58 with wrong length', async () => {
        // Base58 encode a short array (not 64 bytes)
        const shortKey = bs58.encode(new Uint8Array(32));
        process.env.CRANK_WALLET_SECRET_KEY = shortKey;

        await expect(wallet.load()).rejects.toThrow('decoded to 32 bytes, expected 64');
      });
    });

    describe('from file', () => {
      it('loads keypair from JSON file', async () => {
        const secretKeyArray = Array.from(testKeypair.secretKey);
        (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(secretKeyArray));

        await wallet.load();

        expect(wallet.getPublicKey().toBase58()).toBe(testKeypair.publicKey.toBase58());
      });

      it('throws error when file does not exist', async () => {
        (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

        await expect(wallet.load()).rejects.toThrow('Crank wallet not found');
      });

      it('throws error for invalid file content', async () => {
        (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('not valid json');

        await expect(wallet.load()).rejects.toThrow('Failed to load crank wallet from file');
      });
    });

    it('prefers env var over file', async () => {
      // Set up both env var and file
      const envKeypair = Keypair.generate();
      const fileKeypair = Keypair.generate();

      process.env.CRANK_WALLET_SECRET_KEY = JSON.stringify(Array.from(envKeypair.secretKey));
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify(Array.from(fileKeypair.secretKey))
      );

      await wallet.load();

      // Should use env var, not file
      expect(wallet.getPublicKey().toBase58()).toBe(envKeypair.publicKey.toBase58());
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });
  });

  describe('getKeypair', () => {
    it('throws error when wallet not loaded', () => {
      expect(() => wallet.getKeypair()).toThrow('Crank wallet not loaded');
    });

    it('returns keypair when loaded', async () => {
      process.env.CRANK_WALLET_SECRET_KEY = JSON.stringify(Array.from(testKeypair.secretKey));
      await wallet.load();

      const keypair = wallet.getKeypair();
      expect(keypair.publicKey.toBase58()).toBe(testKeypair.publicKey.toBase58());
    });
  });

  describe('getPublicKey', () => {
    it('throws error when wallet not loaded', () => {
      expect(() => wallet.getPublicKey()).toThrow('Crank wallet not loaded');
    });

    it('returns public key when loaded', async () => {
      process.env.CRANK_WALLET_SECRET_KEY = JSON.stringify(Array.from(testKeypair.secretKey));
      await wallet.load();

      expect(wallet.getPublicKey().toBase58()).toBe(testKeypair.publicKey.toBase58());
    });
  });

  describe('getBalance', () => {
    it('throws error when wallet not loaded', async () => {
      await expect(wallet.getBalance()).rejects.toThrow('Crank wallet not loaded');
    });

    it('returns balance in SOL', async () => {
      process.env.CRANK_WALLET_SECRET_KEY = JSON.stringify(Array.from(testKeypair.secretKey));
      await wallet.load();

      (mockConnection.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(5 * LAMPORTS_PER_SOL);

      const balance = await wallet.getBalance();
      expect(balance).toBe(5);
    });
  });

  describe('checkBalance', () => {
    beforeEach(async () => {
      process.env.CRANK_WALLET_SECRET_KEY = JSON.stringify(Array.from(testKeypair.secretKey));
      await wallet.load();
    });

    it('returns sufficient: true when balance >= minBalance', async () => {
      (mockConnection.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(0.5 * LAMPORTS_PER_SOL);

      const result = await wallet.checkBalance();

      expect(result.sufficient).toBe(true);
      expect(result.balance).toBe(0.5);
      expect(result.minRequired).toBe(0.1);
    });

    it('returns sufficient: false when balance < minBalance', async () => {
      (mockConnection.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(0.05 * LAMPORTS_PER_SOL);

      const result = await wallet.checkBalance();

      expect(result.sufficient).toBe(false);
      expect(result.balance).toBe(0.05);
      expect(result.minRequired).toBe(0.1);
    });

    it('returns sufficient: true when balance equals minBalance exactly', async () => {
      (mockConnection.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(0.1 * LAMPORTS_PER_SOL);

      const result = await wallet.checkBalance();

      expect(result.sufficient).toBe(true);
    });
  });

  describe('logBalanceStatus', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      process.env.CRANK_WALLET_SECRET_KEY = JSON.stringify(Array.from(testKeypair.secretKey));
      await wallet.load();
    });

    it('logs normal status and returns false when balance is sufficient', async () => {
      (mockConnection.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(1 * LAMPORTS_PER_SOL);

      const isLow = await wallet.logBalanceStatus();

      expect(isLow).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Balance:'));
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('logs warning and returns true when balance is low', async () => {
      (mockConnection.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(0.05 * LAMPORTS_PER_SOL);

      const isLow = await wallet.logBalanceStatus();

      expect(isLow).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('LOW BALANCE'));
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Fund wallet'));
    });
  });
});

describe('generateCrankWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates directory if it does not exist', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await generateCrankWallet('/test/dir/wallet.json');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/test/dir', { recursive: true });

    consoleSpy.mockRestore();
  });

  it('throws error if wallet file already exists', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(true) // Directory exists
      .mockReturnValueOnce(true); // File exists

    await expect(generateCrankWallet('/test/wallet.json')).rejects.toThrow('Wallet already exists');
  });

  it('generates and saves new keypair', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(true) // Directory exists
      .mockReturnValueOnce(false); // File does not exist

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const keypair = await generateCrankWallet('/test/wallet.json');

    expect(keypair).toBeInstanceOf(Keypair);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^\[[\d,\s]+\]$/) // JSON array of numbers
    );

    consoleSpy.mockRestore();
  });
});
