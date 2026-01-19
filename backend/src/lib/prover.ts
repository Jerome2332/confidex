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

// Get the sunspot binary path
const SUNSPOT_BIN = process.env.SUNSPOT_BIN || join(process.env.HOME || '~', 'sunspot', 'go', 'sunspot');

// Circuit directory (backend/src/lib -> backend -> project root -> circuits/eligibility)
const CIRCUIT_DIR = join(dirname(dirname(dirname(__dirname))), 'circuits', 'eligibility');

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
 * 1. Write prover inputs to Prover.toml
 * 2. Run nargo execute to generate witness
 * 3. Run sunspot prove to generate Groth16 proof
 * 4. Return proof and public witness bytes
 */
export async function generateEligibilityProof(inputs: ProofInputs): Promise<Buffer> {
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

    if (!existsSync(circuitJson) || !existsSync(circuitCcs) || !existsSync(circuitPk)) {
      if (STRICT_PROOF_MODE) {
        throw new Error('Circuit artifacts not found - strict proof mode enabled. Run: cd circuits/eligibility && nargo build && sunspot compile && sunspot setup');
      }
      console.warn('Circuit artifacts not found, using simulated proof (DEV ONLY)');
      return generateSimulatedProof(inputs);
    }

    // Check if sunspot is available
    if (!existsSync(SUNSPOT_BIN)) {
      if (STRICT_PROOF_MODE) {
        throw new Error(`Sunspot not found at ${SUNSPOT_BIN} - strict proof mode enabled. Install Sunspot: https://github.com/Sunspot-Labs/sunspot`);
      }
      console.warn(`Sunspot not found at ${SUNSPOT_BIN}, using simulated proof (DEV ONLY)`);
      return generateSimulatedProof(inputs);
    }

    // Step 1: Run nargo execute with our Prover.toml
    // This generates the witness file
    const witnessPath = join(tempDir, 'eligibility.gz');

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

    // Step 2: Run sunspot prove
    const proofPath = join(tempDir, 'eligibility.proof');
    const pwPath = join(tempDir, 'eligibility.pw');

    // Copy witness if not already there
    if (!existsSync(witnessPath)) {
      await copyFile(join(CIRCUIT_DIR, 'target', 'eligibility.gz'), witnessPath);
    }

    await execAsync(
      `"${SUNSPOT_BIN}" prove "${circuitJson}" "${witnessPath}" "${circuitCcs}" "${circuitPk}" 2>&1`,
      {
        timeout: 60000,
        cwd: tempDir  // Output files go here
      }
    );

    // Read the generated proof
    const proofFile = existsSync(proofPath)
      ? proofPath
      : join(CIRCUIT_DIR, 'target', 'eligibility.proof');

    const rawProof = await readFile(proofFile);

    // Verify proof is exactly the expected size (324 bytes)
    if (rawProof.length !== PROOF_SIZE) {
      console.error(`Unexpected proof size: ${rawProof.length} bytes (expected ${PROOF_SIZE})`);
      throw new Error(`Invalid proof size: ${rawProof.length} bytes`);
    }

    console.log(`Generated real Groth16 proof: ${rawProof.length} bytes`);
    return rawProof;

  } catch (error) {
    console.error('Proof generation failed:', error);
    if (STRICT_PROOF_MODE) {
      throw new Error(`Proof generation failed - strict proof mode enabled: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.warn('Falling back to simulated proof (DEV ONLY)');
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
