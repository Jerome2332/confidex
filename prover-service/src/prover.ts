import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir, copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { randomBytes, createHash } from 'crypto';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

// ES module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Groth16 proof size for Sunspot/gnark format
// Layout: A(64) + B(128) + C(64) + num_commitments(4) + commitment_pok(64) = 324 bytes
export const PROOF_SIZE = 324;

// Strict proof mode
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const STRICT_PROOFS_ENV = process.env.STRICT_PROOFS;
const STRICT_PROOF_MODE = IS_PRODUCTION
  ? STRICT_PROOFS_ENV !== 'false'
  : STRICT_PROOFS_ENV === 'true';

// Get sunspot binary path
const SUNSPOT_BIN = process.env.SUNSPOT_BINARY_PATH ||
                    process.env.SUNSPOT_BIN ||
                    join(process.env.HOME || '~', 'sunspot', 'go', 'sunspot');

// Circuit directory - default to sibling circuits/eligibility
const CIRCUIT_DIR = process.env.CIRCUIT_DIR ||
                    join(dirname(dirname(__dirname)), 'circuits', 'eligibility');

// LRU Cache for proofs
interface CacheEntry {
  proof: Buffer;
  timestamp: number;
  blacklistRoot: string;
}

class ProofLRUCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 100, ttlMs = 30 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  private makeKey(address: string, blacklistRoot: string): string {
    return `${address}:${blacklistRoot}`;
  }

  get(address: string, blacklistRoot: string): Buffer | null {
    const key = this.makeKey(address, blacklistRoot);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.proof;
  }

  set(address: string, blacklistRoot: string, proof: Buffer): void {
    const key = this.makeKey(address, blacklistRoot);

    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      proof,
      timestamp: Date.now(),
      blacklistRoot,
    });
  }

  stats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }
}

const proofCache = new ProofLRUCache(
  parseInt(process.env.PROOF_CACHE_MAX_SIZE || '100', 10),
  parseInt(process.env.PROOF_CACHE_TTL_MS || String(30 * 60 * 1000), 10)
);

export interface ProofInputs {
  address: string;
  blacklistRoot: string;
  merklePath: string[];
  pathIndices: number[];
}

/**
 * Generate a Groth16 eligibility proof using Sunspot/Noir
 */
export async function generateEligibilityProof(inputs: ProofInputs): Promise<Buffer> {
  const startTime = Date.now();

  // Check cache first
  const cached = proofCache.get(inputs.address, inputs.blacklistRoot);
  if (cached) {
    console.log(`[Prover] Cache hit for ${inputs.address.slice(0, 8)}...`);
    return cached;
  }

  console.log(`[Prover] Cache miss, generating proof for ${inputs.address.slice(0, 8)}...`);
  console.log(`[Prover] Sunspot: ${SUNSPOT_BIN}`);
  console.log(`[Prover] Circuit: ${CIRCUIT_DIR}`);

  const tempId = randomBytes(8).toString('hex');
  const tempDir = join(CIRCUIT_DIR, 'temp', tempId);

  try {
    // Create temp directory
    await mkdir(tempDir, { recursive: true });

    // Write Prover.toml
    const proverToml = generateProverToml({
      blacklistRoot: inputs.blacklistRoot,
      merklePath: inputs.merklePath,
      pathIndices: inputs.pathIndices,
    });

    const proverPath = join(tempDir, 'Prover.toml');
    await writeFile(proverPath, proverToml);

    // Check circuit artifacts
    const circuitJson = join(CIRCUIT_DIR, 'target', 'eligibility.json');
    const circuitCcs = join(CIRCUIT_DIR, 'target', 'eligibility.ccs');
    const circuitPk = join(CIRCUIT_DIR, 'target', 'eligibility.pk');

    const missingArtifacts: string[] = [];
    if (!existsSync(circuitJson)) missingArtifacts.push('eligibility.json');
    if (!existsSync(circuitCcs)) missingArtifacts.push('eligibility.ccs');
    if (!existsSync(circuitPk)) missingArtifacts.push('eligibility.pk');

    if (missingArtifacts.length > 0) {
      console.warn(`[Prover] Missing artifacts: ${missingArtifacts.join(', ')}`);
      if (STRICT_PROOF_MODE) {
        throw new Error(`Circuit artifacts not found: ${missingArtifacts.join(', ')}`);
      }
      console.warn('[Prover] Using simulated proof (DEV ONLY)');
      return generateSimulatedProof(inputs);
    }

    // Check sunspot
    if (!existsSync(SUNSPOT_BIN)) {
      console.warn(`[Prover] Sunspot not found at ${SUNSPOT_BIN}`);
      if (STRICT_PROOF_MODE) {
        throw new Error(`Sunspot not found at ${SUNSPOT_BIN}`);
      }
      console.warn('[Prover] Using simulated proof (DEV ONLY)');
      return generateSimulatedProof(inputs);
    }

    // Step 1: nargo execute
    const witnessPath = join(tempDir, 'eligibility.gz');

    console.log('[Prover] Running nargo execute...');
    const nargoStart = Date.now();

    try {
      await execAsync(
        `cd "${CIRCUIT_DIR}" && nargo execute --prover-name "${proverPath}" eligibility 2>&1`,
        { timeout: 30000 }
      );
    } catch {
      // Try alternative: copy Prover.toml to circuit dir
      const origProver = join(CIRCUIT_DIR, 'Prover.toml');
      const backupProver = join(CIRCUIT_DIR, 'Prover.toml.bak');

      try {
        if (existsSync(origProver)) {
          await copyFile(origProver, backupProver);
        }
        await copyFile(proverPath, origProver);

        await execAsync(
          `cd "${CIRCUIT_DIR}" && nargo execute 2>&1`,
          { timeout: 30000 }
        );

        await copyFile(join(CIRCUIT_DIR, 'target', 'eligibility.gz'), witnessPath);
      } finally {
        if (existsSync(backupProver)) {
          await copyFile(backupProver, origProver);
          await execAsync(`rm -f "${backupProver}"`);
        }
      }
    }

    console.log(`[Prover] nargo execute: ${Date.now() - nargoStart}ms`);

    // Step 2: sunspot prove
    const proofPath = join(tempDir, 'eligibility.proof');

    if (!existsSync(witnessPath)) {
      await copyFile(join(CIRCUIT_DIR, 'target', 'eligibility.gz'), witnessPath);
    }

    console.log('[Prover] Running sunspot prove...');
    const sunspotStart = Date.now();

    await execAsync(
      `"${SUNSPOT_BIN}" prove "${circuitJson}" "${witnessPath}" "${circuitCcs}" "${circuitPk}" 2>&1`,
      {
        timeout: 60000,
        cwd: tempDir
      }
    );

    console.log(`[Prover] sunspot prove: ${Date.now() - sunspotStart}ms`);

    // Read proof
    const proofFile = existsSync(proofPath)
      ? proofPath
      : join(CIRCUIT_DIR, 'target', 'eligibility.proof');

    const rawProof = await readFile(proofFile);

    if (rawProof.length !== PROOF_SIZE) {
      throw new Error(`Invalid proof size: ${rawProof.length} bytes`);
    }

    // Cache
    proofCache.set(inputs.address, inputs.blacklistRoot, rawProof);

    console.log(`[Prover] Generated proof in ${Date.now() - startTime}ms`);
    return rawProof;

  } catch (error) {
    console.error('[Prover] Proof generation failed:', error);
    if (STRICT_PROOF_MODE) {
      throw new Error(`Proof generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.warn('[Prover] Falling back to simulated proof');
    return generateSimulatedProof(inputs);
  } finally {
    try {
      await execAsync(`rm -rf "${tempDir}"`);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function generateProverToml(inputs: {
  blacklistRoot: string;
  merklePath: string[];
  pathIndices: number[];
}): string {
  const pathArray = inputs.merklePath
    .map((p) => `    "${p}"`)
    .join(',\n');

  const indicesArray = inputs.pathIndices
    .map((i) => `    "${i === 1 ? '0x01' : '0x00'}"`)
    .join(',\n');

  return `# Auto-generated prover inputs
blacklist_root = "${inputs.blacklistRoot}"
merkle_path = [
${pathArray}
]
path_indices = [
${indicesArray}
]
`;
}

function generateSimulatedProof(inputs: ProofInputs): Buffer {
  const proof = Buffer.alloc(PROOF_SIZE);

  const hashA = createHash('sha256')
    .update(`A:${inputs.address}:${inputs.blacklistRoot}`)
    .digest();
  hashA.copy(proof, 0);
  hashA.copy(proof, 32);

  const hashB1 = createHash('sha256')
    .update(`B1:${inputs.address}`)
    .digest();
  const hashB2 = createHash('sha256')
    .update(`B2:${inputs.blacklistRoot}`)
    .digest();
  hashB1.copy(proof, 64);
  hashB2.copy(proof, 96);
  hashB1.copy(proof, 128);
  hashB2.copy(proof, 160);

  const hashC = createHash('sha256')
    .update(`C:${inputs.address}:${inputs.blacklistRoot}`)
    .digest();
  hashC.copy(proof, 192);
  hashC.copy(proof, 224);

  proof.writeUInt32LE(1, 256);

  const hashPok = createHash('sha256')
    .update(`POK:${inputs.address}:${inputs.blacklistRoot}`)
    .digest();
  hashPok.copy(proof, 260);
  hashPok.copy(proof, 292);

  return proof;
}

export function isProverAvailable(): boolean {
  try {
    execSync('nargo --version', { stdio: 'ignore' });

    if (!existsSync(SUNSPOT_BIN)) {
      return false;
    }

    const required = ['target/eligibility.json', 'target/eligibility.ccs', 'target/eligibility.pk'];
    for (const file of required) {
      if (!existsSync(join(CIRCUIT_DIR, file))) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export interface ProverStatus {
  available: boolean;
  strictMode: boolean;
  sunspotPath: string;
  sunspotFound: boolean;
  circuitDir: string;
  nargoAvailable: boolean;
  nargoVersion: string | null;
  artifacts: {
    json: boolean;
    ccs: boolean;
    pk: boolean;
    vk: boolean;
  };
  cache: {
    size: number;
    maxSize: number;
    ttlMs: number;
  };
}

export function getProverStatus(): ProverStatus {
  let nargoVersion: string | null = null;
  let nargoAvailable = false;

  try {
    const result = execSync('nargo --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    nargoVersion = result.trim();
    nargoAvailable = true;
  } catch {
    nargoAvailable = false;
  }

  return {
    available: isProverAvailable(),
    strictMode: STRICT_PROOF_MODE,
    sunspotPath: SUNSPOT_BIN,
    sunspotFound: existsSync(SUNSPOT_BIN),
    circuitDir: CIRCUIT_DIR,
    nargoAvailable,
    nargoVersion,
    artifacts: {
      json: existsSync(join(CIRCUIT_DIR, 'target', 'eligibility.json')),
      ccs: existsSync(join(CIRCUIT_DIR, 'target', 'eligibility.ccs')),
      pk: existsSync(join(CIRCUIT_DIR, 'target', 'eligibility.pk')),
      vk: existsSync(join(CIRCUIT_DIR, 'target', 'eligibility.vk')),
    },
    cache: proofCache.stats(),
  };
}
