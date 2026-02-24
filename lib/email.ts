// =============================================
// TickClick — Email Utility
// Sends booking confirmation emails via Resend
// =============================================

import { BookingResult, TicketInfo } from "@/types";

interface EmailPayload {
  to: string;
  bookingResult: BookingResult;
  merkleTreeAddress: string;
  userWalletAddress: string;
  venueWalletAddress: string;
}

/**
 * Send booking confirmation email via Resend API
 */
export async function sendBookingEmail(payload: EmailPayload): Promise<{ success: boolean; error?: string }> {
  const { to, bookingResult, merkleTreeAddress, userWalletAddress, venueWalletAddress } = payload;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY not set");
    return { success: false, error: "Email service not configured. Add RESEND_API_KEY to .env.local" };
  }

  const event = bookingResult.event;
  const tickets = bookingResult.tickets;
  const isReal = !tickets[0]?.cnftAssetId.startsWith("DemoAsset");

  // Build HTML email
  const html = buildEmailHtml({
    eventName: event.name,
    venueName: event.venue,
    eventDate: [event.dayOfWeek, event.date].filter(Boolean).join(", ") || "TBA",
    eventTime: event.time || "",
    eventPrice: event.isFree ? "Free" : `$${event.price}`,
    tickets,
    merkleTreeAddress,
    userWalletAddress,
    venueWalletAddress,
    isReal,
    paymentTxHash: bookingResult.paymentTxHash,
  });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "TickClick <onboarding@resend.dev>",
        to: [to],
        subject: `🎟️ TickClick Booking Confirmed: ${event.name}`,
        html: html,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Resend API error:", errorData);
      return { success: false, error: errorData.message || "Failed to send email" };
    }

    const data = await response.json();
    console.log(`📧 Email sent successfully to ${to} (ID: ${data.id})`);
    return { success: true };
  } catch (error: any) {
    console.error("Email send failed:", error);
    return { success: false, error: error.message };
  }
}

// --- Build HTML Email ---

interface EmailData {
  eventName: string;
  venueName: string;
  eventDate: string;
  eventTime: string;
  eventPrice: string;
  tickets: TicketInfo[];
  merkleTreeAddress: string;
  userWalletAddress: string;
  venueWalletAddress: string;
  isReal: boolean;
  paymentTxHash?: string;
}

function buildEmailHtml(data: EmailData): string {
  const explorerBase = "https://explorer.solana.com";

  const ticketRows = data.tickets
    .map(
      (ticket, i) => `
    <tr style="border-bottom: 1px solid #e0e0e0;">
      <td style="padding: 16px; vertical-align: top;">
        <div style="font-size: 18px; font-weight: bold; color: #10b981; margin-bottom: 8px;">
          Ticket ${i + 1}: ${ticket.attendeeName}
        </div>
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 4px 0; color: #666; width: 180px;">Event</td>
            <td style="padding: 4px 0; font-weight: 500;">${ticket.eventName}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">Venue</td>
            <td style="padding: 4px 0; font-weight: 500;">${ticket.venue}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">cNFT Asset ID</td>
            <td style="padding: 4px 0; font-family: monospace; font-size: 12px;">${ticket.cnftAssetId}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">Mint Transaction</td>
            <td style="padding: 4px 0;">
              ${
                data.isReal
                  ? `<a href="${explorerBase}/tx/${ticket.mintTxHash}?cluster=devnet" style="color: #10b981; text-decoration: none; font-family: monospace; font-size: 12px;">${ticket.mintTxHash.slice(0, 30)}...</a>`
                  : `<span style="font-family: monospace; font-size: 12px; color: #999;">Simulated</span>`
              }
            </td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">Status</td>
            <td style="padding: 4px 0;">✅ ${ticket.status}</td>
          </tr>
        </table>
      </td>
    </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <div style="font-size: 32px; margin-bottom: 8px;">🎟️</div>
      <h1 style="color: #10b981; font-size: 24px; margin: 0 0 4px 0;">TickClick</h1>
      <p style="color: #94a3b8; font-size: 14px; margin: 0;">AI Ticket Concierge — Powered by Solana</p>
    </div>

    <!-- Booking Confirmation -->
    <div style="background: white; padding: 32px; border-left: 1px solid #e0e0e0; border-right: 1px solid #e0e0e0;">
      <h2 style="color: #0f172a; font-size: 20px; margin: 0 0 24px 0;">
        🎉 Booking Confirmed${data.isReal ? " — On-Chain!" : ""}
      </h2>

      <!-- Event Details -->
      <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <h3 style="color: #0f172a; font-size: 16px; margin: 0 0 16px 0;">Event Details</h3>
        <table style="width: 100%; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #666; width: 160px;">Event Name</td>
            <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${data.eventName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Venue</td>
            <td style="padding: 6px 0; font-weight: 500;">${data.venueName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Date & Time</td>
            <td style="padding: 6px 0; font-weight: 500;">${data.eventDate || "TBA"}${data.eventTime ? " at " + data.eventTime : ""}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Price</td>
            <td style="padding: 6px 0; font-weight: 500;">${data.eventPrice}</td>
          </tr>
          ${
            data.paymentTxHash && data.isReal
              ? `<tr>
            <td style="padding: 6px 0; color: #666;">Payment Transaction</td>
            <td style="padding: 6px 0;">
              <a href="${explorerBase}/tx/${data.paymentTxHash}?cluster=devnet" style="color: #10b981; text-decoration: none; font-family: monospace; font-size: 12px;">${data.paymentTxHash.slice(0, 30)}...</a>
            </td>
          </tr>`
              : ""
          }
        </table>
      </div>

      <!-- Blockchain Details -->
      <div style="background: #f0fdf4; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <h3 style="color: #0f172a; font-size: 16px; margin: 0 0 16px 0;">🔗 Blockchain Details</h3>
        <table style="width: 100%; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #666; width: 160px;">Network</td>
            <td style="padding: 6px 0; font-weight: 500;">Solana Devnet</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Owner Wallet</td>
            <td style="padding: 6px 0;">
              <a href="${explorerBase}/address/${data.userWalletAddress}?cluster=devnet" style="color: #10b981; text-decoration: none; font-family: monospace; font-size: 12px;">${data.userWalletAddress.slice(0, 20)}...</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Venue (Authority)</td>
            <td style="padding: 6px 0;">
              <a href="${explorerBase}/address/${data.venueWalletAddress}?cluster=devnet" style="color: #10b981; text-decoration: none; font-family: monospace; font-size: 12px;">${data.venueWalletAddress.slice(0, 20)}...</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Merkle Tree</td>
            <td style="padding: 6px 0;">
              <a href="${explorerBase}/address/${data.merkleTreeAddress}?cluster=devnet" style="color: #10b981; text-decoration: none; font-family: monospace; font-size: 12px;">${data.merkleTreeAddress.slice(0, 20)}...</a>
            </td>
          </tr>
        </table>
      </div>

      <!-- Tickets -->
      <div style="margin-bottom: 24px;">
        <h3 style="color: #0f172a; font-size: 16px; margin: 0 0 16px 0;">🎫 Your Tickets</h3>
        <table style="width: 100%; border-collapse: collapse;">
          ${ticketRows}
        </table>
      </div>

      <!-- Verify Button -->
      ${
        data.isReal
          ? `<div style="text-align: center; margin: 24px 0;">
        <a href="${explorerBase}/address/${data.userWalletAddress}?cluster=devnet" 
           style="display: inline-block; background: #10b981; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
          Verify Tickets on Solana Explorer →
        </a>
      </div>`
          : ""
      }
    </div>

    <!-- Footer -->
    <div style="background: #0f172a; border-radius: 0 0 12px 12px; padding: 24px; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0 0 8px 0;">
        TickClick — AI-Powered Ticket Concierge
      </p>
      <p style="color: #64748b; font-size: 11px; margin: 0;">
        Powered by Solana • cNFT tickets via Metaplex Bubblegum • Built for KYD Labs
      </p>
      <p style="color: #475569; font-size: 11px; margin: 8px 0 0 0;">
        This is a devnet demo. Tickets are on Solana devnet for testing purposes.
      </p>
    </div>

  </div>
</body>
</html>`;
}