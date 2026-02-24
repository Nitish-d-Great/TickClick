// =============================================
// TickClick — Booking Execution Tool
// Real cNFT ticket minting on Solana devnet
// Each ticket costs 0.001 SOL booking fee
// =============================================

import {
  purchaseAndMintTicket,
  getExplorerUrl,
  loadWalletFromFile,
  getBalance,
  CnftMetadata,
} from "@/lib/solana";
import {
  BookingRequest,
  BookingResult,
  TicketInfo,
  TicketStatus,
  ScrapedEvent,
  Attendee,
} from "@/types";

// Booking fee per ticket in SOL (devnet)
const BOOKING_FEE_SOL = 0.001;

/**
 * Execute a REAL booking on Solana devnet.
 * - Charges 0.001 SOL per ticket as booking fee
 * - Mints a cNFT ticket for each attendee
 * - Returns real transaction hashes verifiable on Solana Explorer
 */
export async function executeBooking(
  request: BookingRequest
): Promise<BookingResult> {
  const { event, attendees } = request;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🎫 REAL BOOKING — ${event.name}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`   Attendees: ${attendees.map((a) => a.name).join(", ")}`);
  console.log(`   Price: ${event.isFree ? "FREE" : `$${event.price}`}`);
  console.log(`   Booking fee: ${BOOKING_FEE_SOL} SOL per ticket`);
  console.log(`   Total tickets: ${attendees.length}`);

  // Verify environment
  const merkleTree = process.env.MERKLE_TREE_ADDRESS;
  const walletPath = process.env.VENUE_WALLET_KEYPAIR_PATH || "./wallets/venue-wallet.json";
  const userWallet = process.env.USER_WALLET_PUBLIC_KEY;

  console.log(`\n   [Config Check]`);
  console.log(`   MERKLE_TREE_ADDRESS: ${merkleTree ? merkleTree.slice(0, 12) + "..." : "❌ NOT SET"}`);
  console.log(`   VENUE_WALLET_KEYPAIR_PATH: ${walletPath}`);
  console.log(`   USER_WALLET_PUBLIC_KEY: ${userWallet ? userWallet.slice(0, 12) + "..." : "❌ NOT SET"}`);

  if (!merkleTree) {
    console.log(`\n   ⚠️ MERKLE_TREE_ADDRESS not set — using simulation`);
    return simulateBooking(event, attendees);
  }

  if (!userWallet) {
    console.log(`\n   ⚠️ USER_WALLET_PUBLIC_KEY not set — using simulation`);
    return simulateBooking(event, attendees);
  }

  try {
    // Load venue wallet
    const venueKeypair = loadWalletFromFile(walletPath);
    console.log(`\n   ✅ Venue wallet loaded: ${venueKeypair.publicKey.toString().slice(0, 12)}...`);

    // Check balance
    const balance = await getBalance(venueKeypair.publicKey);
    console.log(`   💰 Venue balance: ${balance} SOL`);

    const totalFeesNeeded = BOOKING_FEE_SOL * attendees.length + 0.01; // fees + rent
    if (balance < totalFeesNeeded) {
      throw new Error(
        `Insufficient SOL. Need ~${totalFeesNeeded.toFixed(4)} SOL, have ${balance.toFixed(4)} SOL. ` +
        `Run: solana airdrop 2 ${venueKeypair.publicKey.toString()}`
      );
    }

    const tickets: TicketInfo[] = [];

    // Mint a real cNFT for each attendee
    for (let i = 0; i < attendees.length; i++) {
      const attendee = attendees[i];

      console.log(`\n   ${"─".repeat(40)}`);
      console.log(`   🎟️ Ticket ${i + 1}/${attendees.length}: ${attendee.name}`);
      console.log(`   ${"─".repeat(40)}`);

      const metadata: CnftMetadata = {
        name: `${event.name.replace(/\s*\(Sold Out\)/gi, "")} — ${attendee.name}`,
        symbol: "TICK",
        uri: "",
        eventName: event.name,
        eventDate: event.date,
        venue: event.venue,
        attendeeName: attendee.name,
        pricePaid: event.price,
      };

      const result = await purchaseAndMintTicket(
        venueKeypair,
        merkleTree,
        userWallet,
        metadata,
        BOOKING_FEE_SOL // 0.001 SOL per ticket
      );

      const explorerUrl = getExplorerUrl(result.mintTxHash);

      tickets.push({
        attendeeName: attendee.name,
        cnftAssetId: result.assetId,
        mintTxHash: result.mintTxHash,
        eventName: event.name,
        eventDate: event.date,
        venue: event.venue,
        pricePaid: event.price,
        status: TicketStatus.Active,
        explorerUrl: explorerUrl,
      });

      console.log(`   ✅ REAL ticket minted for ${attendee.name}`);
      console.log(`   🔗 ${explorerUrl}`);
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎉 BOOKING COMPLETE — ${tickets.length} real cNFT tickets!`);
    console.log(`${"=".repeat(60)}\n`);

    return {
      success: true,
      event,
      tickets,
      paymentTxHash: tickets[0]?.mintTxHash,
      totalPaid: event.price * attendees.length,
    };
  } catch (error: any) {
    console.error(`\n❌ REAL BOOKING FAILED: ${error.message}`);
    console.error(`   Stack: ${error.stack?.split("\n")[1]?.trim()}`);
    console.error(`   Falling back to simulation...\n`);

    return simulateBooking(event, attendees);
  }
}

/**
 * Format booking result for chat display.
 */
export function formatBookingResult(result: BookingResult): string {
  if (!result.success) {
    return `❌ Booking failed: ${result.error}\n\nPlease try again or choose a different event.`;
  }

  // Check if tickets are real or simulated
  const isReal = !result.tickets[0]?.cnftAssetId.startsWith("DemoAsset");

  let msg = "";

  if (isReal) {
    msg += `🎉 **Booking Confirmed — Real On-Chain Tickets!**\n\n`;
  } else {
    msg += `🎉 **Booking Confirmed (Demo Mode)**\n\n`;
  }

  msg += `**Event:** ${result.event.name}\n`;
  msg += `**Venue:** ${result.event.venue}\n`;
  const dateStr = result.event.dayOfWeek
    ? `${result.event.dayOfWeek}, ${result.event.date}`
    : result.event.date;
  msg += `**Date:** ${dateStr} at ${result.event.time}\n`;
  msg += `**Total:** ${result.event.isFree ? "FREE" : `$${result.totalPaid}`}\n`;

  if (isReal) {
    msg += `**Booking Fee:** ${(0.001 * result.tickets.length).toFixed(3)} SOL (devnet)\n\n`;
  }

  msg += `\n**Tickets:**\n`;
  result.tickets.forEach((ticket, i) => {
    msg += `\n**Ticket ${i + 1}: ${ticket.attendeeName}**\n`;
    msg += `- Event: ${ticket.eventName}\n`;
    msg += `- Venue: ${ticket.venue}\n`;

    if (isReal) {
      msg += `- cNFT ID: \`${ticket.cnftAssetId}\`\n`;
      msg += `- Mint Tx: \`${ticket.mintTxHash.slice(0, 20)}...\`\n`;
      msg += `- ✅ [Verify on Solana Explorer](${ticket.explorerUrl})\n`;
    } else {
      msg += `- Asset ID: \`${ticket.cnftAssetId}\`\n`;
      msg += `- Status: ✅ ${ticket.status}\n`;
    }
  });

  if (isReal) {
    msg += `\n---\n`;
    msg += `🔗 **These are real compressed NFTs (cNFTs) minted on Solana devnet!**\n`;
    msg += `Each ticket lives on-chain and is owned by your wallet. Click the Explorer links to verify.`;
  } else {
    msg += `\n---\n`;
    msg += `*Demo mode: Configure MERKLE_TREE_ADDRESS and USER_WALLET_PUBLIC_KEY in .env.local for real on-chain tickets.*`;
  }

  return msg;
}

/**
 * Simulation fallback when Solana is not configured.
 */
export function simulateBooking(
  event: ScrapedEvent,
  attendees: Attendee[]
): BookingResult {
  console.log(`\n🎭 SIMULATED BOOKING for: ${event.name}`);
  console.log(`   (Set MERKLE_TREE_ADDRESS + USER_WALLET_PUBLIC_KEY in .env.local for real minting)\n`);

  const mockTxHash = generateMockTxHash();

  const tickets: TicketInfo[] = attendees.map((attendee, i) => ({
    attendeeName: attendee.name,
    cnftAssetId: `DemoAsset_${attendee.name.replace(/\s/g, "_")}_${Date.now()}_${i}`,
    mintTxHash: mockTxHash,
    eventName: event.name,
    eventDate: event.date,
    venue: event.venue,
    pricePaid: event.price,
    status: TicketStatus.Active,
    explorerUrl: `https://explorer.solana.com/tx/${mockTxHash}?cluster=devnet`,
  }));

  return {
    success: true,
    event,
    tickets,
    paymentTxHash: event.price > 0 ? mockTxHash : undefined,
    totalPaid: event.price * attendees.length,
  };
}

function generateMockTxHash(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 88; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}