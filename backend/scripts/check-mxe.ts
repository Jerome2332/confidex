/**
 * Check if MXE is initialized
 */
import { PublicKey, Connection } from '@solana/web3.js';

async function main() {
  const conn = new Connection('https://api.devnet.solana.com');
  const mxeProgram = new PublicKey('CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE');
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('mxe_config')], mxeProgram);
  console.log('MXE Config PDA:', configPda.toBase58());

  const info = await conn.getAccountInfo(configPda);
  if (info) {
    console.log('Account exists! Size:', info.data.length, 'bytes');
    console.log('Owner:', info.owner.toBase58());
  } else {
    console.log('Account does not exist - needs initialization');
  }
}

main().catch(console.error);
