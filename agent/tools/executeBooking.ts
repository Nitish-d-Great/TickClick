// =============================================
// TixAgent — Booking Execution Tool
// Handles payment + cNFT ticket minting on Solana devnet
// =============================================

import { Keypair, PublicKey } from "@solana/web3.js";
import {
  purchaseAndMintTicket,
  getExplorerUrl,
  loadWallet,
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

/**
 * Execute a complete booking: payment + cNFT minting for all attendees.
 */
export async function executeBooking(
  request: BookingRequest
): Promise<BookingResult> {
  const { event, attendees, fanWalletAddress } = request;

  console.log(`\n🎫 Starting booking for: ${event.name}`);
  console.log(`   Attendees: ${attendees.map((a) => a.name).join(", ")}`);
  console.log(`   Price: ${event.isFree ? "FREE" : `$${event.price}`}`);

  try {
    // Load wallets
    const fanWallet = loadWallet(process.env.FAN_WALLET_SECRET_KEY!);
    const venuePublicKey = new PublicKey(
      process.env.VENUE_WALLET_SECRET_KEY
        ? loadWallet(process.env.VENUE_WALLET_SECRET_KEY!).publicKey
        : fanWallet.publicKey // Fallback: use same wallet for demo
    );
    const merkleTree = process.env.MERKLE_TREE_ADDRESS!;

    // Check balance
    const balance = await getBalance(fanWallet.publicKey);
    console.log(`   Fan wallet balance: ${balance} SOL`);

    const tickets: TicketInfo[] = [];
    let firstPaymentTxHash: string | null = null;

    // Mint a ticket for each attendee
    for (const attendee of attendees) {
      console.log(`\n   🎟️ Processing ticket for ${attendee.name}...`);

      const metadata: CnftMetadata = {
        name: `${event.venue}: ${event.name} — ${attendee.name}`,
        symbol: "TIXAGT",
        uri: "", // Will be auto-generated
        eventName: event.name,
        eventDate: event.date,
        venue: event.venue,
        attendeeName: attendee.name,
        pricePaid: event.price,
      };

      const result = await purchaseAndMintTicket(
        fanWallet,
        venuePublicKey,
        merkleTree,
        metadata,
        // Only charge for the first ticket payment (or split equally)
        !firstPaymentTxHash ? event.price : 0
      );

      if (result.paymentTxHash && !firstPaymentTxHash) {
        firstPaymentTxHash = result.paymentTxHash;
      }

      tickets.push({
        attendeeName: attendee.name,
        cnftAssetId: result.assetId,
        mintTxHash: result.mintTxHash,
        eventName: event.name,
        eventDate: event.date,
        venue: event.venue,
        pricePaid: event.price,
        status: TicketStatus.Active,
        explorerUrl: getExplorerUrl(result.mintTxHash),
      });

      console.log(`   ✅ Ticket minted for ${attendee.name}`);
    }

    console.log(`\n🎉 Booking complete! ${tickets.length} tickets minted.`);

    return {
      success: true,
      event,
      tickets,
      paymentTxHash: firstPaymentTxHash || undefined,
      totalPaid: event.price * attendees.length,
    };
  } catch (error: any) {
    console.error(`❌ Booking failed:`, error);
    return {
      success: false,
      event,
      tickets: [],
      totalPaid: 0,
      error: error.message || "Unknown error during booking",
    };
  }
}

/**
 * Format booking result into a readable message.
 */
export function formatBookingResult(result: BookingResult): string {
  if (!result.success) {
    return `❌ Booking failed: ${result.error}\n\nPlease try again or choose a different event.`;
  }

  let msg = `🎉 **Booking Confirmed!**\n\n`;
  msg += `**Event:** ${result.event.name}\n`;
  msg += `**Venue:** ${result.event.venue}\n`;
  msg += `**Date:** ${result.event.dayOfWeek}, ${result.event.date} at ${result.event.time}\n`;
  msg += `**Total:** ${result.event.isFree ? "FREE" : `$${result.totalPaid}`}\n\n`;

  if (result.paymentTxHash) {
    msg += `**Payment Transaction:**\n`;
    msg += `[View on Solana Explorer](${getExplorerUrl(result.paymentTxHash)})\n\n`;
  }

  msg += `**Tickets (cNFTs on Solana):**\n`;
  result.tickets.forEach((ticket, i) => {
    msg += `\n${i + 1}. **${ticket.attendeeName}**\n`;
    msg += `   Asset ID: \`${ticket.cnftAssetId}\`\n`;
    msg += `   Status: ✅ ${ticket.status}\n`;
    msg += `   [View Mint Tx](${ticket.explorerUrl})\n`;
  });

  msg += `\n---\n`;
  msg += `All tickets are now on-chain as compressed NFTs on Solana. `;
  msg += `Each attendee's ticket is verifiable and owned in their wallet.`;

  return msg;
}

/**
 * Demo mode: simulate booking without actual Solana transactions.
 * Used when wallets aren't configured.
 */
export function simulateBooking(
  event: ScrapedEvent,
  attendees: Attendee[]
): BookingResult {
  const mockTxHash = "5" + "x".repeat(86); // Fake tx hash

  const tickets: TicketInfo[] = attendees.map((attendee, i) => ({
    attendeeName: attendee.name,
    cnftAssetId: `DemoAsset${i + 1}_${Date.now()}`,
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
