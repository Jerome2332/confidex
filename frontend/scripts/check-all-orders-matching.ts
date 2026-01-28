import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=a5993fde-e283-4034-82cf-6a6fef562a19';
const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const WALLET = new PublicKey('3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm');
const ORDER_SIZE_V5 = 366;

interface OrderInfo {
  pda: string;
  nonce: bigint;
  status: number;
  statusName: string;
  isMatching: boolean;
  hasPendingMatch: boolean;
  wouldPassIsActive: boolean;
}

async function main() {
  const connection = new Connection(RPC_URL);

  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { dataSize: ORDER_SIZE_V5 },
      { memcmp: { offset: 8, bytes: WALLET.toBase58() } },
    ],
  });

  console.log('Checking is_matching flag for all orders...\n');

  const statusNames = ['Active', 'Filled', 'Cancelled', 'Expired', 'Matching'];
  const orders: OrderInfo[] = [];

  for (const { pubkey, account } of accounts) {
    const data = account.data as Uint8Array;
    const status = data[266];
    const isMatching = data[332] === 1;
    const pendingMatch = data.slice(300, 332);
    const hasPendingMatch = pendingMatch.some((b: number) => b !== 0);

    const nonceView = new DataView(data.buffer, data.byteOffset + 291, 8);
    const nonce = nonceView.getBigUint64(0, true);

    orders.push({
      pda: pubkey.toBase58(),
      nonce,
      status,
      statusName: statusNames[status] || 'Unknown',
      isMatching,
      hasPendingMatch,
      wouldPassIsActive: status === 0 && !isMatching,
    });
  }

  // Sort by nonce
  orders.sort((a, b) => Number(a.nonce - b.nonce));

  // Display
  console.log('Nonce | Status     | is_matching | pending_match | Can Cancel?');
  console.log('─'.repeat(70));

  for (const o of orders) {
    const canCancel = o.wouldPassIsActive ? '✅ Yes' : '❌ No';
    console.log(
      o.nonce.toString().padStart(5) + ' | ' +
      o.statusName.padEnd(10) + ' | ' +
      (o.isMatching ? 'true ' : 'false') + '       | ' +
      (o.hasPendingMatch ? 'true ' : 'false') + '         | ' +
      canCancel
    );
  }

  const cancellable = orders.filter(o => o.wouldPassIsActive);
  const stuckInMatching = orders.filter(o => o.status === 0 && o.isMatching);

  console.log('\n' + '─'.repeat(70));
  console.log('Summary:');
  console.log('  Total orders:', orders.length);
  console.log('  Active orders:', orders.filter(o => o.status === 0).length);
  console.log('  Stuck in matching (is_matching=true):', stuckInMatching.length);
  console.log('  Actually cancellable:', cancellable.length);

  if (stuckInMatching.length > 0) {
    console.log('\n⚠️  Orders stuck in matching flow need admin intervention to reset is_matching flag');
  }
}

main().catch(console.error);
