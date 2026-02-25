// =============================================
// TixAgent — Chat API Route
// POST /api/agent — handles user messages
// Passes userWallet, bookingResult, calendarToken, attendeeEmails
// =============================================

import { NextRequest, NextResponse } from "next/server";
import { handleMessage, resetAgentState } from "@/agent";
import { ChatMessage } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      message,
      history = [],
      userWallet,
      bookingResult: clientBookingResult,
      calendarToken,
      attendeeEmails,
    } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Convert history to ChatMessage format
    const conversationHistory: ChatMessage[] = history.map((msg: any) => ({
      id: msg.id || crypto.randomUUID(),
      role: msg.role,
      content: msg.content,
      timestamp: new Date(msg.timestamp || Date.now()),
    }));

    // Handle special commands
    if (message.toLowerCase() === "/reset") {
      resetAgentState();
      return NextResponse.json({
        response: "Agent state reset. Ready for a new search!",
        toolCalls: [],
      });
    }

    // Process message through agent
    const result = await handleMessage(
      message,
      conversationHistory,
      userWallet || undefined,
      clientBookingResult || undefined,
      calendarToken || undefined,
      attendeeEmails || undefined
    );

    return NextResponse.json({
      response: result.response,
      toolCalls: result.toolCalls,
      tickets: result.tickets || [],
      events: result.events || [],
      walletAction: result.walletAction || null,
      pendingBooking: result.pendingBooking || null,
      bookingResult: result.bookingResult || null,
      needsEmails: result.needsEmails || false,
    });
  } catch (error: any) {
    console.error("Agent API error:", error);
    return NextResponse.json(
      {
        error: "Agent encountered an error",
        details: error.message,
        response:
          "Sorry, I ran into an issue processing your request. Please try again.",
        toolCalls: [],
      },
      { status: 500 }
    );
  }
}