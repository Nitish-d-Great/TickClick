// =============================================
// TixAgent — Merkle Tree Setup Script
// Creates a Bubblegum-compatible Merkle tree on Solana devnet
// Required before minting cNFTs
// Run: npx ts-node scripts/create-merkle-tree.ts
// =============================================

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
  publicKey,
} from "@metaplex-foundation/umi";
import { createTree, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import {
  Keypair,
  Connection,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";

async function main() {
  console.log("🌳 TixAgent — Merkle Tree Setup\n");

  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");

  // Load or generate payer wallet
  let payer: Keypair;
  if (process.env.FAN_WALLET_SECRET_KEY) {
    const secretKey = Buffer.from(process.env.FAN_WALLET_SECRET_KEY, "hex");
    payer = Keypair.fromSecretKey(new Uint8Array(secretKey));
    console.log(`Using existing wallet: ${payer.publicKey.toString()}`);
  } else {
    payer = Keypair.generate();
    console.log(`Generated new wallet: ${payer.publicKey.toString()}`);

    // Airdrop
    const connection = new Connection(rpcUrl, "confirmed");
    console.log("Requesting airdrop...");
    const sig = await connection.requestAirdrop(
      payer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
    console.log("✅ 2 SOL airdropped");
  }

  // Create Umi instance
  const umi = createUmi(rpcUrl).use(mplBubblegum());
  const umiKeypair = fromWeb3JsKeypair(payer);
  umi.use(keypairIdentity(umiKeypair));

  // Generate Merkle tree keypair
  const merkleTree = generateSigner(umi);

  console.log(`\nCreating Merkle tree...`);
  console.log(`Tree address: ${merkleTree.publicKey}`);

  // Create the tree
  // maxDepth: 14 = up to 16,384 cNFTs
  // maxBufferSize: 64 = concurrent minting buffer
  const builder = await createTree(umi, {
    merkleTree,
    maxDepth: 14,
    maxBufferSize: 64,
  });
  const { signature } = await builder.sendAndConfirm(umi);

  console.log(`\n✅ Merkle tree created!`);
  console.log(`   Address: ${merkleTree.publicKey}`);
  console.log(`   Max cNFTs: 16,384`);
  console.log(`   Tx: https://explorer.solana.com/tx/${Buffer.from(signature).toString("base64")}?cluster=devnet`);

  console.log(`\n=== Add to your .env file ===\n`);
  console.log(`MERKLE_TREE_ADDRESS=${merkleTree.publicKey}`);
}

main().catch(console.error);
