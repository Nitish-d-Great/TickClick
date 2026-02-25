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
  eventImage?: string; // Event poster image URL (from KYD scraper or fallback)
}

export interface MintResult {
  assetId: string;
  mintTxHash: string;
  paymentTxHash: string | null;
  metadataUri: string; // The metadata URI used for this cNFT
  eventImage: string;  // The event poster image URL
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

// --- Build Metadata URI ---

/**
 * Build a dynamic metadata URI pointing to our /api/ticket-metadata endpoint.
 * This serves Metaplex-standard JSON with the event poster image.
 * 
 * IMPORTANT: Bubblegum URI max is ~200 chars. We use the app's own base URL
 * so the metadata is always resolvable. For production, use Arweave/IPFS.
 */
function buildMetadataUri(metadata: CnftMetadata): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  // Encode minimal params to stay under 200 chars
  const params = new URLSearchParams({
    e: (metadata.eventName || "Event").slice(0, 30),
    a: (metadata.attendeeName || "Attendee").slice(0, 15),
    v: (metadata.venue || "Venue").slice(0, 20),
  });

  const uri = `${baseUrl}/api/ticket-metadata?${params.toString()}`;

  // Bubblegum enforces ~200 char limit on URI
  if (uri.length > 200) {
    // Fallback to a short static URI if too long
    return `${baseUrl}/api/ticket-metadata?e=Event&a=Guest`;
  }

  return uri;
}

// --- Resolve Event Image ---

/** Get the best available image for this event/venue */
function resolveEventImage(metadata: CnftMetadata): string {
  // 1. Use explicit event image if provided (e.g., from KYD scraper)
  if (metadata.eventImage) return metadata.eventImage;

  // 2. Fallback to venue-specific poster images
  const venueLower = (metadata.venue || "").toLowerCase();
  if (venueLower.includes("poisson rouge") || venueLower.includes("lpr")) {
    return "https://images.unsplash.com/photo-1501386761578-0a55d8f28b23?w=600&q=80";
  }
  if (venueLower.includes("mike nasty") || venueLower.includes("djmikenasty")) {
    return "https://images.unsplash.com/photo-1571266028243-3716f02d2d58?w=600&q=80";
  }

  // 3. Generic concert/event image
  return "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=600&q=80";
}

// --- cNFT Minting via Bubblegum (real on-chain) ---

export async function mintCnftTicket(
  treeAuthorityKeypair: Keypair,
  merkleTreeAddress: string,
  ownerAddress: string,
  metadata: CnftMetadata
): Promise<{ txSignature: string; metadataUri: string; eventImage: string }> {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");

  console.log(`   [Mint] Creating UMI instance...`);
  console.log(`   [Mint] Tree: ${merkleTreeAddress}`);
  console.log(`   [Mint] Owner: ${ownerAddress}`);
  console.log(`   [Mint] Authority: ${treeAuthorityKeypair.publicKey.toString()}`);

  // Create UMI instance with tree authority (venue wallet)
  const umi = createUmi(rpcUrl).use(mplBubblegum());
  const umiKeypair = fromWeb3JsKeypair(treeAuthorityKeypair);
  umi.use(keypairIdentity(umiKeypair));

  // Build dynamic metadata URI
  const metadataUri = buildMetadataUri(metadata);
  const eventImage = resolveEventImage(metadata);

  // Bubblegum max name is 32 chars. Strip "(Sold Out)" and truncate.
  const cleanName = metadata.name.replace(/\s*\(Sold Out\)/gi, "").trim();
  const name = cleanName.length > 32
    ? cleanName.slice(0, 29) + "..."
    : cleanName;

  console.log(`   [Mint] Name: "${name}"`);
  console.log(`   [Mint] URI: "${metadataUri}" (${metadataUri.length} chars)`);
  console.log(`   [Mint] Image: "${eventImage}"`);
  console.log(`   [Mint] Sending mintV1 transaction...`);

  // Mint the cNFT
  const { signature } = await mintV1(umi, {
    leafOwner: umiPublicKey(ownerAddress),
    merkleTree: umiPublicKey(merkleTreeAddress),
    metadata: {
      name: name,
      symbol: "TICK",
      uri: metadataUri,
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

  return { txSignature, metadataUri, eventImage };
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
    const userPubkey = new PublicKey(ownerAddress);
    paymentTxHash = await transferSol(venueKeypair, userPubkey, bookingFeeSol);
  } else {
    console.log(`   🆓 No booking fee for this ticket`);
  }

  // Step 2: Mint cNFT ticket (venue is tree authority, user is owner)
  const { txSignature, metadataUri, eventImage } = await mintCnftTicket(
    venueKeypair,
    merkleTreeAddress,
    ownerAddress,
    metadata
  );

  return {
    assetId: `cnft_${Date.now()}_${metadata.attendeeName.replace(/\s/g, "")}`,
    mintTxHash: txSignature,
    paymentTxHash: paymentTxHash,
    metadataUri: metadataUri,
    eventImage: eventImage,
  };
}

// --- Explorer URL ---

export function getExplorerUrl(txSignature: string): string {
  return `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`;
}