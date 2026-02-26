// =============================================
// TixAgent — Execute Booking API Route
// POST /api/agent/execute-booking
// Called after Phantom wallet confirmation
// Now also passes calendarToken for post-booking event creation
// =============================================

import { NextRequest, NextResponse } from "next/server";
import { executePendingBooking } from "@/agent";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      event,
      attendees,
      userWallet,
      paymentTxHash,
      walletSignature,
      calendarToken,
      attendeeEmails,
    } = body;

    if (!event || !attendees || !userWallet) {
      return NextResponse.json(
        { error: "Missing required fields: event, attendees, userWallet" },
        { status: 400 }
      );
    }

    console.log(`\n[Execute-Booking] Wallet-confirmed booking`);
    console.log(`   Event: ${event.name}`);
    console.log(`   Attendees: ${attendees.map((a: any) => a.name).join(", ")}`);
    console.log(`   Wallet: ${userWallet.slice(0, 8)}...`);
    console.log(`   Payment Tx: ${paymentTxHash || "N/A (free event)"}`);
    console.log(`   Calendar: ${calendarToken ? "connected" : "not connected"}`);
    console.log(
      `   Wallet Signature: ${walletSignature ? walletSignature.slice(0, 16) + "..." : "N/A"}`
    );

    const result = await executePendingBooking(
      event,
      attendees,
      userWallet,
      paymentTxHash,
      calendarToken || undefined,
      attendeeEmails || undefined
    );

    return NextResponse.json({
      response: result.response,
      toolCalls: result.toolCalls,
      tickets: result.tickets || [],
      bookingResult: result.bookingResult || null,
    });
  } catch (error: any) {
    console.error("[Execute-Booking] Error:", error);
    return NextResponse.json(
      {
        error: "Booking execution failed",
        response: `❌ Booking failed: ${error.message}. Please try again.`,
        toolCalls: [],
        tickets: [],
        bookingResult: null,
      },
      { status: 500 }
    );
  }
}