import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir, copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { randomBytes, createHash } from 'crypto';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

// Strict proof mode - when enabled, rejects simulated proofs and requires real ZK infrastructure
// Set STRICT_PROOFS=true in production to ensure no fake proofs are accepted
const STRICT_PROOF_MODE = process.env.STRICT_PROOFS === 'true';

// ES module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Groth16 proof size for Sunspot/gnark format
// Layout: A(64) + B(128) + C(64) + num_commitments(4) + commitment_pok(64) = 324 bytes
export const PROOF_SIZE = 324;

// Get the sunspot binary path - configurable via env var
// Default: ~/sunspot/go/sunspot (standard installation path)
const SUNSPOT_BIN = process.env.SUNSPOT_BINARY_PATH ||
                    process.env.SUNSPOT_BIN ||
                    join(process.env.HOME || '~', 'sunspot', 'go', 'sunspot');

// Circuit directory (backend/src/lib -> backend -> project root -> circuits/eligibility)
const CIRCUIT_DIR = process.env.CIRCUIT_DIR ||
                    join(dirname(dirname(dirname(__dirname))), 'circuits', 'eligibility');

// ============================================================================
// LRU Cache for Proof Caching
// ============================================================================

interface CacheEntry {
  proof: Buffer;
  timestamp: number;
  blacklistRoot: string;
}

class ProofLRUCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 100, ttlMs = 30 * 60 * 1000) { // Default 30 min TTL
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Generate cache key from address and blacklist root
   */
  private makeKey(address: string, blacklistRoot: string): string {
    return `${address}:${blacklistRoot}`;
  }

  /**
   * Get cached proof if valid
   */
  get(address: string, blacklistRoot: string): Buffer | null {
    const key = this.makeKey(address, blacklistRoot);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.proof;
  }

  /**
   * Store proof in cache
   */
  set(address: string, blacklistRoot: string, proof: Buffer): void {
    const key = this.makeKey(address, blacklistRoot);

    // Evict oldest if at capacity
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

  /**
   * Invalidate all entries for a specific blacklist root
   * Call this when blacklist is updated
   */
  invalidateByRoot(blacklistRoot: string): number {
    let invalidated = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.blacklistRoot === blacklistRoot) {
        this.cache.delete(key);
        invalidated++;
      }
    }
    return invalidated;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }
}

// Singleton proof cache instance
const proofCache = new ProofLRUCache(
  parseInt(process.env.PROOF_CACHE_MAX_SIZE || '100', 10),
  parseInt(process.env.PROOF_CACHE_TTL_MS || String(30 * 60 * 1000), 10)
);

// Export cache for invalidation from blacklist updates
export { proofCache };

interface ProofInputs {
  address: string;
  blacklistRoot: string;
  merklePath: string[];
  pathIndices: number[];
}

interface ProofResult {
  proof: Buffer;
  publicWitness: Buffer;
  blacklistRoot: string;
}

/**
 * Generate a Groth16 eligibility proof using Sunspot/Noir
 *
 * Workflow:
 * 1. Check cache first
 * 2. Write prover inputs to Prover.toml
 * 3. Run nargo execute to generate witness
 * 4. Run sunspot prove to generate Groth16 proof
 * 5. Cache and return proof
 *
 * Environment variables:
 * - SUNSPOT_BINARY_PATH: Path to sunspot binary (default: ~/sunspot/go/sunspot)
 * - CIRCUIT_DIR: Path to circuit directory (default: circuits/eligibility)
 * - STRICT_PROOFS: Set to 'true' to reject simulated proofs
 * - PROOF_CACHE_MAX_SIZE: Max cached proofs (default: 100)
 * - PROOF_CACHE_TTL_MS: Cache TTL in ms (default: 30 min)
 */
export async function generateEligibilityProof(inputs: ProofInputs): Promise<Buffer> {
  const startTime = Date.now();

  // Check cache first
  const cached = proofCache.get(inputs.address, inputs.blacklistRoot);
  if (cached) {
    console.log(`[prover] Cache hit for ${inputs.address.slice(0, 8)}... (${Date.now() - startTime}ms)`);
    return cached;
  }

  console.log(`[prover] Cache miss for ${inputs.address.slice(0, 8)}..., generating proof`);
  console.log(`[prover] Using sunspot binary: ${SUNSPOT_BIN}`);
  console.log(`[prover] Using circuit directory: ${CIRCUIT_DIR}`);

  const tempId = randomBytes(8).toString('hex');
  const tempDir = join(CIRCUIT_DIR, 'temp', tempId);

  try {
    // Create temp directory
    await mkdir(tempDir, { recursive: true });

    // Write Prover.toml with the inputs
    const proverToml = generateProverToml({
      blacklistRoot: inputs.blacklistRoot,
      merklePath: inputs.merklePath,
      pathIndices: inputs.pathIndices,
    });

    const proverPath = join(tempDir, 'Prover.toml');
    await writeFile(proverPath, proverToml);

    // Check if circuit artifacts exist
    const circuitJson = join(CIRCUIT_DIR, 'target', 'eligibility.json');
    const circuitCcs = join(CIRCUIT_DIR, 'target', 'eligibility.ccs');
    const circuitPk = join(CIRCUIT_DIR, 'target', 'eligibility.pk');

    const missingArtifacts: string[] = [];
    if (!existsSync(circuitJson)) missingArtifacts.push('eligibility.json');
    if (!existsSync(circuitCcs)) missingArtifacts.push('eligibility.ccs');
    if (!existsSync(circuitPk)) missingArtifacts.push('eligibility.pk');

    if (missingArtifacts.length > 0) {
      console.warn(`[prover] Missing circuit artifacts: ${missingArtifacts.join(', ')}`);
      if (STRICT_PROOF_MODE) {
        throw new Error(`Circuit artifacts not found: ${missingArtifacts.join(', ')} - strict proof mode enabled. Run: cd circuits/eligibility && nargo build && sunspot compile && sunspot setup`);
      }
      console.warn('[prover] Using simulated proof (DEV ONLY)');
      return generateSimulatedProof(inputs);
    }

    // Check if sunspot is available
    if (!existsSync(SUNSPOT_BIN)) {
      console.warn(`[prover] Sunspot not found at ${SUNSPOT_BIN}`);
      if (STRICT_PROOF_MODE) {
        throw new Error(`Sunspot not found at ${SUNSPOT_BIN} - strict proof mode enabled. Install Sunspot: https://github.com/Sunspot-Labs/sunspot`);
      }
      console.warn('[prover] Using simulated proof (DEV ONLY)');
      return generateSimulatedProof(inputs);
    }

    // Step 1: Run nargo execute with our Prover.toml
    // This generates the witness file
    const witnessPath = join(tempDir, 'eligibility.gz');

    console.log(`[prover] Step 1: Running nargo execute...`);
    const nargoStart = Date.now();

    try {
      // nargo execute reads Prover.toml from current directory
      await execAsync(
        `cd "${CIRCUIT_DIR}" && nargo execute --prover-name "${proverPath}" eligibility 2>&1`,
        { timeout: 30000 }
      );
    } catch (nargoError) {
      // Try alternative: copy Prover.toml to circuit dir temporarily
      const origProver = join(CIRCUIT_DIR, 'Prover.toml');
      const backupProver = join(CIRCUIT_DIR, 'Prover.toml.bak');

      try {
        // Backup original
        if (existsSync(origProver)) {
          await copyFile(origProver, backupProver);
        }
        // Copy our prover
        await copyFile(proverPath, origProver);

        // Run nargo execute
        await execAsync(
          `cd "${CIRCUIT_DIR}" && nargo execute 2>&1`,
          { timeout: 30000 }
        );

        // Copy witness to our temp dir
        await copyFile(join(CIRCUIT_DIR, 'target', 'eligibility.gz'), witnessPath);

      } finally {
        // Restore original Prover.toml
        if (existsSync(backupProver)) {
          await copyFile(backupProver, origProver);
          await execAsync(`rm -f "${backupProver}"`);
        }
      }
    }

    console.log(`[prover] nargo execute completed (${Date.now() - nargoStart}ms)`);

    // Step 2: Run sunspot prove
    const proofPath = join(tempDir, 'eligibility.proof');

    // Copy witness if not already there
    if (!existsSync(witnessPath)) {
      await copyFile(join(CIRCUIT_DIR, 'target', 'eligibility.gz'), witnessPath);
    }

    console.log(`[prover] Step 2: Running sunspot prove...`);
    const sunspotStart = Date.now();

    await execAsync(
      `"${SUNSPOT_BIN}" prove "${circuitJson}" "${witnessPath}" "${circuitCcs}" "${circuitPk}" 2>&1`,
      {
        timeout: 60000,
        cwd: tempDir  // Output files go here
      }
    );

    console.log(`[prover] sunspot prove completed (${Date.now() - sunspotStart}ms)`);

    // Read the generated proof
    const proofFile = existsSync(proofPath)
      ? proofPath
      : join(CIRCUIT_DIR, 'target', 'eligibility.proof');

    const rawProof = await readFile(proofFile);

    // Verify proof is exactly the expected size (324 bytes)
    if (rawProof.length !== PROOF_SIZE) {
      console.error(`[prover] Unexpected proof size: ${rawProof.length} bytes (expected ${PROOF_SIZE})`);
      throw new Error(`Invalid proof size: ${rawProof.length} bytes`);
    }

    // Cache the proof
    proofCache.set(inputs.address, inputs.blacklistRoot, rawProof);

    const totalDuration = Date.now() - startTime;
    console.log(`[prover] Generated real Groth16 proof: ${rawProof.length} bytes (total: ${totalDuration}ms)`);
    return rawProof;

  } catch (error) {
    console.error('[prover] Proof generation failed:', error);
    if (STRICT_PROOF_MODE) {
      throw new Error(`Proof generation failed - strict proof mode enabled: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.warn('[prover] Falling back to simulated proof (DEV ONLY)');
    return generateSimulatedProof(inputs);
  } finally {
    // Cleanup temp directory
    try {
      await execAsync(`rm -rf "${tempDir}"`);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Generate Prover.toml content
 * Note: We no longer include 'address' as the simplified circuit doesn't use it
 */
function generateProverToml(inputs: {
  blacklistRoot: string;
  merklePath: string[];
  pathIndices: number[];
}): string {
  // Format merkle path
  const pathArray = inputs.merklePath
    .map((p) => `    "${p}"`)
    .join(',\n');

  // Format path indices
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

/**
 * Generate a simulated proof for development
 * WARNING: This is NOT a valid ZK proof - for testing only
 *
 * Format (324 bytes total):
 * - A: G1 point (64 bytes)
 * - B: G2 point (128 bytes)
 * - C: G1 point (64 bytes)
 * - num_commitments: u32 (4 bytes)
 * - commitment_pok: (64 bytes)
 */
function generateSimulatedProof(inputs: ProofInputs): Buffer {
  const proof = Buffer.alloc(PROOF_SIZE);

  // Fill with deterministic but fake data
  // In production, this MUST be replaced with actual proof generation

  // G1 point A (64 bytes) - offset 0
  const hashA = createHash('sha256')
    .update(`A:${inputs.address}:${inputs.blacklistRoot}`)
    .digest();
  hashA.copy(proof, 0);
  hashA.copy(proof, 32);

  // G2 point B (128 bytes) - offset 64
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

  // G1 point C (64 bytes) - offset 192
  const hashC = createHash('sha256')
    .update(`C:${inputs.address}:${inputs.blacklistRoot}`)
    .digest();
  hashC.copy(proof, 192);
  hashC.copy(proof, 224);

  // num_commitments: u32 = 1 (4 bytes) - offset 256
  proof.writeUInt32LE(1, 256);

  // commitment_pok (64 bytes) - offset 260
  const hashPok = createHash('sha256')
    .update(`POK:${inputs.address}:${inputs.blacklistRoot}`)
    .digest();
  hashPok.copy(proof, 260);
  hashPok.copy(proof, 292);

  return proof;
}

/**
 * Check if proof generation infrastructure is available
 */
export function isProverAvailable(): boolean {
  try {
    // Check nargo
    execSync('nargo --version', { stdio: 'ignore' });

    // Check sunspot
    if (!existsSync(SUNSPOT_BIN)) {
      return false;
    }

    // Check circuit artifacts
    const circuitDir = CIRCUIT_DIR;
    const required = ['target/eligibility.json', 'target/eligibility.ccs', 'target/eligibility.pk'];
    for (const file of required) {
      if (!existsSync(join(circuitDir, file))) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get detailed prover status for health checks
 */
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

  const sunspotFound = existsSync(SUNSPOT_BIN);

  return {
    available: isProverAvailable(),
    strictMode: STRICT_PROOF_MODE,
    sunspotPath: SUNSPOT_BIN,
    sunspotFound,
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

/**
 * Get the pre-generated empty tree proof if it exists
 * This is useful for quick verification when blacklist is empty
 */
export async function getPreGeneratedEmptyTreeProof(): Promise<Buffer | null> {
  const proofPath = join(CIRCUIT_DIR, 'target', 'eligibility.proof');
  if (!existsSync(proofPath)) {
    return null;
  }

  try {
    const proof = await readFile(proofPath);
    if (proof.length === PROOF_SIZE) {
      return proof;
    }
    return null;
  } catch {
    return null;
  }
}
