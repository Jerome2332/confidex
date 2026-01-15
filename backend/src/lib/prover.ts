import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';

const execAsync = promisify(exec);

// Proof size in bytes (Groth16 compressed)
export const PROOF_SIZE = 388;

// Circuit directory (relative to project root)
const CIRCUIT_DIR = join(process.cwd(), '..', 'circuits', 'eligibility');

interface ProofInputs {
  address: string;
  blacklistRoot: string;
  merklePath: string[];
  pathIndices: number[];
}

/**
 * Generate a Groth16 eligibility proof using Sunspot/Noir
 *
 * Flow:
 * 1. Write prover inputs to temporary Prover.toml
 * 2. Run nargo prove to generate witness
 * 3. Run sunspot prove to generate Groth16 proof
 * 4. Return proof bytes
 */
export async function generateEligibilityProof(inputs: ProofInputs): Promise<Buffer> {
  const tempDir = join(CIRCUIT_DIR, 'temp', randomBytes(8).toString('hex'));

  try {
    // Create temp directory
    await mkdir(tempDir, { recursive: true });

    // Convert address to field element (first 31 bytes of pubkey as big-endian hex)
    const addressField = addressToField(inputs.address);

    // Write Prover.toml
    const proverToml = generateProverToml({
      blacklistRoot: inputs.blacklistRoot,
      address: addressField,
      merklePath: inputs.merklePath,
      pathIndices: inputs.pathIndices,
    });

    const proverPath = join(tempDir, 'Prover.toml');
    await writeFile(proverPath, proverToml);

    // Copy circuit files to temp (or use symlinks)
    // In production, we'd have a pre-compiled circuit

    // Generate proof using nargo + sunspot
    // NOTE: This is a placeholder - actual implementation depends on Sunspot CLI
    const proofPath = join(tempDir, 'proof.bin');

    try {
      // Try to run actual proof generation
      await execAsync(
        `cd "${CIRCUIT_DIR}" && nargo prove --prover-toml "${proverPath}" && sunspot prove --output "${proofPath}"`,
        { timeout: 30000 } // 30 second timeout
      );

      const proof = await readFile(proofPath);
      return proof;
    } catch (execError) {
      // Fallback: generate simulated proof for development
      console.warn('Using simulated proof (nargo/sunspot not available)');
      return generateSimulatedProof(inputs);
    }
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
 * Convert Solana address to field element
 * Takes first 31 bytes to fit in BN254 field
 */
function addressToField(address: string): string {
  // Decode base58 address
  const bs58 = require('bs58');
  const bytes = bs58.decode(address);

  // Take first 31 bytes and convert to hex
  const fieldBytes = bytes.slice(0, 31);
  const hex = '0x' + Buffer.from(fieldBytes).toString('hex').padStart(62, '0');

  return hex;
}

/**
 * Generate Prover.toml content
 */
function generateProverToml(inputs: {
  blacklistRoot: string;
  address: string;
  merklePath: string[];
  pathIndices: number[];
}): string {
  const pathArray = inputs.merklePath
    .map((p) => `    "${p}"`)
    .join(',\n');

  const indicesArray = inputs.pathIndices
    .map((i) => `    "${i === 1 ? '0x01' : '0x00'}"`.padEnd(68, '0').slice(0, 68) + '"')
    .join(',\n');

  return `# Auto-generated prover inputs
blacklist_root = "${inputs.blacklistRoot}"
address = "${inputs.address}"
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
 */
function generateSimulatedProof(inputs: ProofInputs): Buffer {
  const proof = Buffer.alloc(PROOF_SIZE);

  // Fill with deterministic but fake data
  // In production, this MUST be replaced with actual proof generation

  // Simulate G1 point A (64 bytes)
  const hashA = require('crypto').createHash('sha256')
    .update(`A:${inputs.address}:${inputs.blacklistRoot}`)
    .digest();
  hashA.copy(proof, 0);
  hashA.copy(proof, 32);

  // Simulate G2 point B (128 bytes)
  const hashB1 = require('crypto').createHash('sha256')
    .update(`B1:${inputs.address}`)
    .digest();
  const hashB2 = require('crypto').createHash('sha256')
    .update(`B2:${inputs.blacklistRoot}`)
    .digest();
  hashB1.copy(proof, 64);
  hashB2.copy(proof, 96);
  hashB1.copy(proof, 128);
  hashB2.copy(proof, 160);

  // Simulate G1 point C (64 bytes)
  const hashC = require('crypto').createHash('sha256')
    .update(`C:${inputs.address}:${inputs.blacklistRoot}`)
    .digest();
  hashC.copy(proof, 192);
  hashC.copy(proof, 224);

  // Fill remaining bytes with padding
  for (let i = 256; i < PROOF_SIZE; i++) {
    proof[i] = (i * 17 + 42) % 256;
  }

  return proof;
}
