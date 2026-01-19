import { createRequire } from 'module';
import { PublicKey } from '@solana/web3.js';
import { config } from 'dotenv';

/**
 * Script to set market resolvable status to true (V2 market).
 * Only the admin (from global config) can call this function.
 */

// Load environment variables
config();

// Load SDK from built CommonJS bundle
const require = createRequire(import.meta.url);
const { PNPClient } = require('../dist/index.cjs');

// === Configuration ===
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com'; // Default to devnet
const PRIVATE_KEY = process.env.PNP_PRIVATE_KEY; // Admin private key from .env
const MARKET_ADDRESS = process.argv[2] || process.env.MARKET_ADDRESS; // From command line or env
const VERBOSE = true;

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error('PNP_PRIVATE_KEY environment variable is required in .env');
  }

  if (!MARKET_ADDRESS) {
    console.error('❌ Error: Market address is required');
    console.error('   Usage: npx tsx scripts/setMarketResolvableTrue.ts <market_address>');
    console.error('   Or set MARKET_ADDRESS in .env');
    process.exit(1);
  }

  const secretKey = PNPClient.parseSecretKey(PRIVATE_KEY);
  const client = new PNPClient(RPC_URL, secretKey);

  if (!client.market) {
    throw new Error('PNPClient.market is undefined. Ensure modules are properly initialized.');
  }

  const marketPk = new PublicKey(MARKET_ADDRESS);

  // Fetch admin address from global config first
  const { account: globalConfig } = await client.fetchGlobalConfig();
  const actualAdminAddress = typeof globalConfig.admin === 'string' 
    ? globalConfig.admin 
    : new PublicKey(globalConfig.admin).toBase58();
  const yourWalletAddress = client.signer!.publicKey.toBase58();

  if (VERBOSE) {
    console.log('🔧 Setting Market Resolvable Status to TRUE:');
    console.log('   RPC URL:', RPC_URL);
    console.log('   Network:', RPC_URL.includes('devnet') ? 'DEVNET' : RPC_URL.includes('mainnet') ? 'MAINNET' : 'UNKNOWN');
    console.log('   Program ID:', client.client.programId.toBase58());
    if (process.env.CONTRACT_FACTORY_ADDRESS) {
      console.log('   (Using CONTRACT_FACTORY_ADDRESS from env)');
    }
    console.log('   Your Wallet:', yourWalletAddress);
    console.log('   Admin Address (from global config):', actualAdminAddress);
    console.log('   Market Address:', MARKET_ADDRESS);
  }

  // Check current market status and verify admin
  try {
    const { account: marketAccount } = await client.fetchMarket(marketPk);
    if (VERBOSE) {
      console.log('\n📊 Current Market Status:');
      console.log('   Question:', marketAccount.question);
      console.log('   Current Resolvable:', marketAccount.resolvable);
      console.log('   Resolved:', marketAccount.resolved);
    }
    
    // Verify admin (we already fetched it above)
    // COMMENTED OUT: Admin check temporarily disabled
    console.log('\n🔑 Admin Verification:');
    console.log('   Your Wallet:', yourWalletAddress);
    console.log('   Admin Address (from global config):', actualAdminAddress);
    console.log('   Match:', yourWalletAddress === actualAdminAddress ? '✅ YES' : '❌ NO');
    
    // if (yourWalletAddress !== actualAdminAddress) {
    //   console.error('\n❌ Error: Your wallet is not the admin!');
    //   console.error(`   You need to use the admin's private key.`);
    //   console.error(`   Admin Address: ${actualAdminAddress}`);
    //   console.error(`   Your Address: ${yourWalletAddress}`);
    //   process.exit(1);
    // }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Set resolvable to true
  console.log('\n⏳ Setting resolvable status to true...');
  try {
    const result = await client.setMarketResolvable(marketPk, true);

    // Output Result
    const output = {
      success: true,
      signature: result.signature,
      market: MARKET_ADDRESS,
      resolvable: true,
    };

    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(output, null, 2));
    console.log('==============\n');

    console.log('✅ Market resolvable status set to TRUE!');
    console.log(`   Market Address: ${MARKET_ADDRESS}`);
    console.log(`   Signature: https://solscan.io/tx/${result.signature}?cluster=devnet`);

    // Verify the change
    if (VERBOSE) {
      console.log('\n⏳ Verifying change...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for confirmation
      const { account: updatedMarket } = await client.fetchMarket(marketPk);
      console.log('   Updated Resolvable Status:', updatedMarket.resolvable);
      if (updatedMarket.resolvable === true) {
        console.log('   ✅ Verification successful!');
      } else {
        console.log('   ⚠️  Warning: Status may not have updated yet. Check again in a moment.');
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Error setting market resolvable status:', errorMsg);
    
    if (errorMsg.includes('Only admin')) {
      console.error('\n   💡 Make sure you are using the admin private key (from global config)');
    }
    
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});