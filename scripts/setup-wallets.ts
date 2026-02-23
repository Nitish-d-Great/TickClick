// =============================================
// TixAgent — Wallet Setup Script
// Generates fan + venue wallets on Solana devnet
// Run: npx ts-node scripts/setup-wallets.ts
// =============================================

import { Keypair, Connection, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🔑 TixAgent Wallet Setup\n");
  console.log("========================\n");

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Generate Fan Wallet
  const fanWallet = Keypair.generate();
  console.log("👤 Fan Wallet:");
  console.log(`   Public Key: ${fanWallet.publicKey.toString()}`);

  // Generate Venue Wallet
  const venueWallet = Keypair.generate();
  console.log("\n🏛️  Venue Wallet (simulated KYD Labs):");
  console.log(`   Public Key: ${venueWallet.publicKey.toString()}`);

  // Airdrop SOL to fan wallet
  console.log("\n💧 Requesting devnet airdrop for fan wallet...");
  try {
    const sig = await connection.requestAirdrop(
      fanWallet.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
    console.log("   ✅ 2 SOL airdropped to fan wallet");
  } catch (error) {
    console.log("   ⚠️ Airdrop failed (devnet may be rate-limited). Try again later.");
  }

  // Airdrop SOL to venue wallet (for rent)
  console.log("\n💧 Requesting devnet airdrop for venue wallet...");
  try {
    const sig = await connection.requestAirdrop(
      venueWallet.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
    console.log("   ✅ 1 SOL airdropped to venue wallet");
  } catch (error) {
    console.log("   ⚠️ Airdrop failed. Try again later.");
  }

  // Convert secret keys to base58 for .env
  const fanSecretBase58 = Buffer.from(fanWallet.secretKey).toString("base64");
  const venueSecretBase58 = Buffer.from(venueWallet.secretKey).toString("base64");

  // Generate .env content
  const envContent = `
# === TixAgent Wallet Configuration ===
# Generated on ${new Date().toISOString()}

FAN_WALLET_SECRET_KEY=${Buffer.from(fanWallet.secretKey).toString("hex")}
VENUE_WALLET_SECRET_KEY=${Buffer.from(venueWallet.secretKey).toString("hex")}

# Public Keys (for reference)
# Fan:   ${fanWallet.publicKey.toString()}
# Venue: ${venueWallet.publicKey.toString()}
`.trim();

  // Save to file
  const envPath = path.join(__dirname, "..", ".env.wallets");
  fs.writeFileSync(envPath, envContent);
  console.log(`\n📝 Wallet keys saved to: ${envPath}`);
  console.log("   Copy the values to your .env file.\n");

  // Print .env values
  console.log("=== Add to your .env file ===\n");
  console.log(`FAN_WALLET_SECRET_KEY=${Buffer.from(fanWallet.secretKey).toString("hex")}`);
  console.log(`VENUE_WALLET_SECRET_KEY=${Buffer.from(venueWallet.secretKey).toString("hex")}`);
  console.log(`\n# Wallet Public Keys`);
  console.log(`# Fan: ${fanWallet.publicKey.toString()}`);
  console.log(`# Venue: ${venueWallet.publicKey.toString()}`);
}

main().catch(console.error);
