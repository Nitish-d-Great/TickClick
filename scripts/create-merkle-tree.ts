// =============================================
// TickClick — Merkle Tree Setup Script
// Creates a Bubblegum-compatible Merkle tree on Solana devnet
// Run: npx ts-node scripts/create-merkle-tree.ts
// =============================================

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
} from "@metaplex-foundation/umi";
import { createTree, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { Keypair, Connection, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { readFileSync } from "fs";

async function main() {
  console.log("🌳 TickClick — Merkle Tree Setup\n");

  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");

  // Load venue wallet from JSON file (created by create-venue-keypair.ts)
  const walletPath = "./wallets/venue-wallet.json";
  let payer: Keypair;

  try {
    const walletData = JSON.parse(readFileSync(walletPath, "utf-8"));
    payer = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log(`✅ Loaded venue wallet: ${payer.publicKey.toString()}`);
  } catch (error) {
    console.error(`❌ Could not load wallet from ${walletPath}`);
    console.error(`   Run this first: npx ts-node scripts/create-venue-keypair.ts`);
    process.exit(1);
  }

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  const solBalance = balance / LAMPORTS_PER_SOL;
  console.log(`   Balance: ${solBalance} SOL`);

  if (solBalance < 0.5) {
    console.log(`\n⚠️  Low balance. Requesting airdrop...`);
    try {
      const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      console.log(`   ✅ 2 SOL airdropped`);
    } catch (e) {
      console.error(`   ❌ Airdrop failed. Try: solana airdrop 2 ${payer.publicKey.toString()}`);
      process.exit(1);
    }
  }

  // Create UMI instance
  const umi = createUmi(rpcUrl).use(mplBubblegum());
  const umiKeypair = fromWeb3JsKeypair(payer);
  umi.use(keypairIdentity(umiKeypair));

  // Generate Merkle tree keypair
  const merkleTree = generateSigner(umi);

  console.log(`\n🌳 Creating Merkle tree...`);
  console.log(`   Tree address: ${merkleTree.publicKey}`);
  console.log(`   Max depth: 14 (supports up to 16,384 cNFTs)`);
  console.log(`   Buffer size: 64`);

  // Create the tree
  try {
    const builder = await createTree(umi, {
      merkleTree,
      maxDepth: 14,
      maxBufferSize: 64,
    });

    const result = await builder.sendAndConfirm(umi);
    const txHash = Buffer.from(result.signature).toString("base64");

    console.log(`\n✅ Merkle tree created successfully!`);
    console.log(`   Address: ${merkleTree.publicKey}`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${txHash}?cluster=devnet`);

    console.log(`\n========================================`);
    console.log(`  Add this to your .env.local file:`);
    console.log(`  MERKLE_TREE_ADDRESS=${merkleTree.publicKey}`);
    console.log(`========================================\n`);
  } catch (error: any) {
    console.error(`\n❌ Failed to create Merkle tree:`, error.message);
    if (error.message?.includes("insufficient")) {
      console.error(`   Not enough SOL. Run: solana airdrop 2 ${payer.publicKey.toString()}`);
    }
    process.exit(1);
  }
}

main().catch(console.error);