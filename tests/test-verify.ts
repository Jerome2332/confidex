import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import * as crypto from 'crypto';
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const VERIFIER_PROGRAM_ID = new PublicKey('9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W');

const PROOF_HEX = '256a1c68d478f28fee71b37633d77a1c62433e3b6d234642f114f887837e12ca2f8a3ac89b3110f2c3fe5e63f661daca3e384e2f57362b3c7327516ca17668d802b161fcaca8f926c8a73b877f239b3fe8d4178d24fe166bf0b4552c943e42b80e8a308309dcfb2ed2a573677f0fc5039255afa24c4761a5d707fa42a0aa593612c4f786ea9d93cabab566128897b17fbe6796bcf21bb766ad468273863b81040c0bf677b74ce6eb9cb3fa9d351212d316e34cc1636fa794b83c9604dd82136007826b4354b020006b176298ddf2858d64264ad5f35a4538264ddba7f5536b73193067af707182c0608ee1318ecb42adb24efcff676c36caf07b3e1c2abf5a950000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const keypairPath = `${process.env.HOME}/.config/solana/id.json`;
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const trader = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  console.log('Trader:', trader.publicKey.toString());
  
  const [exchangePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('exchange')],
    PROGRAM_ID
  );
  const [eligibilityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('trader_eligibility'), trader.publicKey.toBuffer()],
    PROGRAM_ID
  );
  
  console.log('Exchange PDA:', exchangePda.toString());
  console.log('Eligibility PDA:', eligibilityPda.toString());
  
  const proof = Buffer.from(PROOF_HEX, 'hex');
  console.log('Proof length:', proof.length, 'bytes');
  
  const VERIFY_ELIGIBILITY_DISCRIMINATOR = computeDiscriminator('verify_eligibility');
  
  const instructionData = Buffer.alloc(8 + 324);
  VERIFY_ELIGIBILITY_DISCRIMINATOR.copy(instructionData, 0);
  proof.copy(instructionData, 8);
  
  const verifyIx = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: eligibilityPda, isSigner: false, isWritable: true },
      { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: trader.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: instructionData,
  });
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  tx.add(verifyIx);
  
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = trader.publicKey;
  
  console.log('\nSimulating transaction...');
  const sim = await connection.simulateTransaction(tx, [trader]);
  
  console.log('Simulation error:', sim.value.err);
  console.log('Units consumed:', sim.value.unitsConsumed);
  console.log('\nLogs:');
  sim.value.logs?.forEach((log: string) => console.log(' ', log));
  
  if (!sim.value.err) {
    console.log('\n✅ Simulation passed! Sending transaction...');
    tx.sign(trader);
    const sig = await connection.sendRawTransaction(tx.serialize());
    console.log('Signature:', sig);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('✅ Transaction confirmed!');
  }
}

main().catch(console.error);
