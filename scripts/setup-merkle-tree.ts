import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createTree } from '@metaplex-foundation/mpl-bubblegum';
import { generateSigner, keypairIdentity } from '@metaplex-foundation/umi';
import { readFileSync } from 'fs';

async function main() {
  // Connect to devnet
  const umi = createUmi('https://api.devnet.solana.com');

  // Load venue wallet (tree authority)
  const walletFile = JSON.parse(readFileSync('./wallets/venue-wallet.json', 'utf-8'));
  const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(walletFile));
  umi.use(keypairIdentity(keypair));

  // Create a Merkle tree for cNFTs
  // maxDepth: 14 = supports up to 16,384 cNFTs
  // maxBufferSize: 64 = concurrent mint capacity
  const merkleTree = generateSigner(umi);

  const tx = await createTree(umi, {
    merkleTree,
    maxDepth: 14,
    maxBufferSize: 64,
  });

  await tx.sendAndConfirm(umi);

  console.log('Merkle Tree created!');
  console.log('Tree address:', merkleTree.publicKey);
  console.log('Save this address — you need it for .env.local');
}

main().catch(console.error);