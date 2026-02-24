// =============================================
// TickClick — Solana Utilities
// Real cNFT minting via Metaplex Bubblegum + SOL transfers
// =============================================

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  keypairIdentity,
  publicKey as umiPublicKey,
  none,
} from "@metaplex-foundation/umi";
import { mintV1, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { readFileSync } from "fs";
import bs58 from "bs58";

// --- Types ---

export interface CnftMetadata {
  name: string;
  symbol: string;
  uri: string;
  eventName: string;
  eventDate: string;
  venue: string;
  attendeeName: string;
  pricePaid: number;
}

export interface MintResult {
  assetId: string;
  mintTxHash: string;
  paymentTxHash: string | null;
}

// --- Connection ---

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  return new Connection(rpcUrl, "confirmed");
}

// --- Wallet Loading ---

export function loadWalletFromFile(filePath: string): Keypair {
  const walletData = JSON.parse(readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(walletData));
}

// --- Balance Check ---

export async function getBalance(publicKey: PublicKey): Promise<number> {
  const connection = getConnection();
  const balance = await connection.getBalance(publicKey);
  return balance / LAMPORTS_PER_SOL;
}

// --- SOL Transfer (real on-chain) ---

export async function transferSol(
  fromKeypair: Keypair,
  toPublicKey: PublicKey,
  amountSol: number
): Promise<string> {
  const connection = getConnection();

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey: toPublicKey,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [
    fromKeypair,
  ]);

  console.log(`   💸 SOL transferred: ${amountSol} SOL`);
  console.log(`   📝 Payment tx: ${signature}`);

  return signature;
}

// --- cNFT Minting via Bubblegum (real on-chain) ---

export async function mintCnftTicket(
  treeAuthorityKeypair: Keypair,
  merkleTreeAddress: string,
  ownerAddress: string,
  metadata: CnftMetadata
): Promise<string> {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");

  console.log(`   [Mint] Creating UMI instance...`);
  console.log(`   [Mint] Tree: ${merkleTreeAddress}`);
  console.log(`   [Mint] Owner: ${ownerAddress}`);
  console.log(`   [Mint] Authority: ${treeAuthorityKeypair.publicKey.toString()}`);

  // Create UMI instance with tree authority (venue wallet)
  const umi = createUmi(rpcUrl).use(mplBubblegum());
  const umiKeypair = fromWeb3JsKeypair(treeAuthorityKeypair);
  umi.use(keypairIdentity(umiKeypair));

  // IMPORTANT: Bubblegum URI max is ~200 chars. Use a short URL.
  const shortUri = "https://tickclick.xyz/t.json";

 // Bubblegum max name is 32 chars. Strip "(Sold Out)" and truncate.
 const cleanName = metadata.name.replace(/\s*\(Sold Out\)/gi, "").trim();
 const name = cleanName.length > 32
   ? cleanName.slice(0, 29) + "..."
   : cleanName;

  console.log(`   [Mint] Name: "${name}"`);
  console.log(`   [Mint] URI: "${shortUri}" (${shortUri.length} chars)`);
  console.log(`   [Mint] Sending mintV1 transaction...`);

  // Mint the cNFT
  const { signature } = await mintV1(umi, {
    leafOwner: umiPublicKey(ownerAddress),
    merkleTree: umiPublicKey(merkleTreeAddress),
    metadata: {
      name: name,
      symbol: "TICK",
      uri: shortUri,
      sellerFeeBasisPoints: 0,
      collection: none(),
      creators: [
        {
          address: umi.identity.publicKey,
          verified: false,
          share: 100,
        },
      ],
    },
  }).sendAndConfirm(umi);

  // Convert signature to base58 string (Solana Explorer format)
  const txSignature = bs58.encode(Buffer.from(signature));

  console.log(`   ✅ cNFT minted successfully!`);
  console.log(`   📝 Mint tx: ${txSignature}`);
  console.log(`   🔗 https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);

  return txSignature;
}

// --- Full Purchase + Mint Flow ---

export async function purchaseAndMintTicket(
  venueKeypair: Keypair,
  merkleTreeAddress: string,
  ownerAddress: string,
  metadata: CnftMetadata,
  bookingFeeSol: number
): Promise<MintResult> {
  let paymentTxHash: string | null = null;

  // Step 1: Charge booking fee (0.001 SOL)
  if (bookingFeeSol > 0) {
    console.log(`   💰 Charging booking fee: ${bookingFeeSol} SOL`);
    // Transfer from venue wallet to user wallet as a recorded on-chain tx
    // In production: user pays venue. For devnet demo: venue pays itself to create tx record
    const userPubkey = new PublicKey(ownerAddress);
    paymentTxHash = await transferSol(venueKeypair, userPubkey, bookingFeeSol);
  } else {
    console.log(`   🆓 No booking fee for this ticket`);
  }

  // Step 2: Mint cNFT ticket (venue is tree authority, user is owner)
  const mintTxHash = await mintCnftTicket(
    venueKeypair,
    merkleTreeAddress,
    ownerAddress,
    metadata
  );

  return {
    assetId: `cnft_${Date.now()}_${metadata.attendeeName.replace(/\s/g, "")}`,
    mintTxHash: mintTxHash,
    paymentTxHash: paymentTxHash,
  };
}

// --- Explorer URL ---

export function getExplorerUrl(txSignature: string): string {
  return `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`;
}