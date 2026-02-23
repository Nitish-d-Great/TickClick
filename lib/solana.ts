// =============================================
// TixAgent — Solana Utilities
// Handles: wallet management, SOL transfers, cNFT minting
// =============================================

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
  publicKey as umiPublicKey,
  sol,
} from "@metaplex-foundation/umi";
import {
  mintV1,
  mplBubblegum,
  parseLeafFromMintV1Transaction,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  fromWeb3JsKeypair,
  fromWeb3JsPublicKey,
  toWeb3JsPublicKey,
} from "@metaplex-foundation/umi-web3js-adapters";
import bs58 from "bs58";

// --- Configuration ---

const SOLANA_RPC = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const EXPLORER_BASE = "https://explorer.solana.com";

export function getConnection(): Connection {
  return new Connection(SOLANA_RPC, "confirmed");
}

export function getExplorerUrl(
  signature: string,
  type: "tx" | "address" = "tx"
): string {
  return `${EXPLORER_BASE}/${type}/${signature}?cluster=devnet`;
}

// --- Wallet Management ---

export function createWallet(): Keypair {
  return Keypair.generate();
}

export function loadWallet(secretKeyBase58: string): Keypair {
  const secretKey = bs58.decode(secretKeyBase58);
  return Keypair.fromSecretKey(secretKey);
}

export function walletToBase58(wallet: Keypair): string {
  return bs58.encode(wallet.secretKey);
}

export async function getBalance(publicKey: PublicKey): Promise<number> {
  const connection = getConnection();
  const balance = await connection.getBalance(publicKey);
  return balance / LAMPORTS_PER_SOL;
}

export async function requestAirdrop(
  publicKey: PublicKey,
  amountSol: number = 2
): Promise<string> {
  const connection = getConnection();
  const signature = await connection.requestAirdrop(
    publicKey,
    amountSol * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

// --- SOL Transfer (Payment) ---

export async function transferSol(
  fromWallet: Keypair,
  toPublicKey: PublicKey,
  amountSol: number
): Promise<string> {
  const connection = getConnection();

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromWallet.publicKey,
      toPubkey: toPublicKey,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [
    fromWallet,
  ]);

  console.log(
    `✅ Payment of ${amountSol} SOL sent. Tx: ${getExplorerUrl(signature)}`
  );
  return signature;
}

/**
 * Convert a USD ticket price to a proportional devnet SOL amount.
 * We use a simple ratio: $100 = 0.01 SOL on devnet.
 * This makes the demo visually clear without spending real funds.
 */
export function usdToDevnetSol(usdPrice: number): number {
  if (usdPrice <= 0) return 0;
  const ratio = 0.0001; // $1 = 0.0001 SOL on devnet
  return parseFloat((usdPrice * ratio).toFixed(6));
}

// --- cNFT Minting via Metaplex Bubblegum ---

export interface CnftMetadata {
  name: string; // e.g., "LPR: Jazz Night - Aman"
  symbol: string; // e.g., "TIXAGT"
  uri: string; // Metadata JSON URI (can be placeholder for hackathon)
  eventName: string;
  eventDate: string;
  venue: string;
  attendeeName: string;
  pricePaid: number;
}

export async function mintTicketCnft(
  payerWallet: Keypair,
  merkleTreeAddress: string,
  recipientAddress: string,
  metadata: CnftMetadata
): Promise<{ assetId: string; txSignature: string }> {
  // Create Umi instance
  const umi = createUmi(SOLANA_RPC).use(mplBubblegum());

  // Set payer as identity
  const umiKeypair = fromWeb3JsKeypair(payerWallet);
  umi.use(keypairIdentity(umiKeypair));

  const merkleTree = umiPublicKey(merkleTreeAddress);
  const recipient = umiPublicKey(recipientAddress);

  // Build cNFT metadata with ticket attributes
  const nftMetadata = {
    name: metadata.name,
    symbol: metadata.symbol || "TIXAGT",
    uri: metadata.uri || buildMetadataUri(metadata),
    sellerFeeBasisPoints: 500, // 5% royalty to venue on resale
    collection: null,
    creators: [
      {
        address: fromWeb3JsPublicKey(payerWallet.publicKey),
        verified: true,
        share: 100,
      },
    ],
  };

  // Mint the cNFT
  const { signature } = await mintV1(umi, {
    leafOwner: recipient,
    merkleTree: merkleTree,
    metadata: {
      ...nftMetadata,
      creators: nftMetadata.creators,
    },
  }).sendAndConfirm(umi);

  // Parse the leaf to get asset ID
  const leaf = await parseLeafFromMintV1Transaction(umi, signature);
  const assetId = leaf.id;

  const txSignature = bs58.encode(signature);

  console.log(`✅ cNFT minted for ${metadata.attendeeName}`);
  console.log(`   Asset ID: ${assetId}`);
  console.log(`   Tx: ${getExplorerUrl(txSignature)}`);

  return {
    assetId: assetId.toString(),
    txSignature,
  };
}

/**
 * Build a placeholder metadata URI for the cNFT.
 * In production, this would be uploaded to Arweave/IPFS.
 * For the hackathon, we use a data URI with JSON metadata.
 */
function buildMetadataUri(metadata: CnftMetadata): string {
  const metadataJson = {
    name: metadata.name,
    symbol: metadata.symbol || "TIXAGT",
    description: `Ticket for ${metadata.eventName} at ${metadata.venue} on ${metadata.eventDate}. Attendee: ${metadata.attendeeName}.`,
    image:
      "https://arweave.net/placeholder-ticket-image", // Replace with real image
    external_url: "https://tix-agent.vercel.app",
    attributes: [
      { trait_type: "Event", value: metadata.eventName },
      { trait_type: "Venue", value: metadata.venue },
      { trait_type: "Date", value: metadata.eventDate },
      { trait_type: "Attendee", value: metadata.attendeeName },
      { trait_type: "Price (USD)", value: metadata.pricePaid.toString() },
      { trait_type: "Status", value: "Active" },
    ],
    properties: {
      category: "ticket",
      creators: [],
    },
  };

  // For hackathon: use a base64 data URI
  // In production: upload to Arweave/IPFS and return the URI
  const encoded = Buffer.from(JSON.stringify(metadataJson)).toString("base64");
  return `data:application/json;base64,${encoded}`;
}

// --- Atomic Pay + Mint ---

/**
 * Executes payment and cNFT minting.
 * For free events: only mints.
 * For paid events: transfers SOL then mints.
 */
export async function purchaseAndMintTicket(
  fanWallet: Keypair,
  venuePublicKey: PublicKey,
  merkleTreeAddress: string,
  metadata: CnftMetadata,
  priceUsd: number
): Promise<{
  paymentTxHash: string | null;
  mintTxHash: string;
  assetId: string;
}> {
  let paymentTxHash: string | null = null;

  // Step 1: Payment (skip for free events)
  if (priceUsd > 0) {
    const solAmount = usdToDevnetSol(priceUsd);
    paymentTxHash = await transferSol(fanWallet, venuePublicKey, solAmount);
    console.log(`💰 Payment complete: ${solAmount} SOL ($${priceUsd})`);
  } else {
    console.log(`🆓 Free event — skipping payment`);
  }

  // Step 2: Mint cNFT ticket
  const mintResult = await mintTicketCnft(
    fanWallet,
    merkleTreeAddress,
    fanWallet.publicKey.toString(),
    metadata
  );

  return {
    paymentTxHash,
    mintTxHash: mintResult.txSignature,
    assetId: mintResult.assetId,
  };
}
