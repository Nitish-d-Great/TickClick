// =============================================
// TickClick — Conversational AI Ticket Agent
// Uses LLM to decide actions dynamically
// Executes REAL Solana transactions when configured
// Sends booking confirmation emails via Resend
// Supports Phantom wallet for user-signed bookings
// Google Calendar integration for availability check
// =============================================

import OpenAI from "openai";
import { SYSTEM_PROMPT, INTENT_EXTRACTION_PROMPT } from "./prompts/system";
import { discoverEvents, getStaticEventData } from "./tools/scrapeEvents";
import {
  getMockAvailability,
  findOverlappingFreeSlots,
  checkCalendarForEvent,
  formatCalendarResults,
} from "./tools/checkCalendar";
import { matchEvents, formatMatchResults } from "./tools/matchEvents";
import {
  executeBooking,
  simulateBooking,
  formatBookingResult,
} from "./tools/executeBooking";
import { sendBookingEmail } from "@/lib/email";
import {
  ChatMessage,
  UserIntent,
  ScrapedEvent,
  EventMatch,
  ToolCallResult,
  Attendee,
  BookingResult,
} from "@/types";

// --- Agent State ---

interface AgentState {
  events: ScrapedEvent[];
  matches: EventMatch[];
  intent: UserIntent | null;
  awaitingConfirmation: boolean;
  lastPresentedEvents: EventMatch[];
  awaitingEmail: boolean;
  lastBookingResult: BookingResult | null;
  // Calendar conflict state
  awaitingBookAnyway: boolean;
  pendingConflictBooking: {
    event: ScrapedEvent;
    attendees: Attendee[];
    userWallet?: string;
  } | null;
}

const state: AgentState = {
  events: [],
  matches: [],
  intent: null,
  awaitingConfirmation: false,
  lastPresentedEvents: [],
  awaitingEmail: false,
  lastBookingResult: null,
  awaitingBookAnyway: false,
  pendingConflictBooking: null,
};

// --- Devnet pricing: price / 10000 SOL ---
function calculateDevnetSol(priceUsd: number): number {
  if (priceUsd <= 0) return 0;
  return priceUsd / 10000;
}

// --- Groq Client ---

function getLLMClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set in environment variables");
  return new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
}

const LLM_MODEL = "llama-3.3-70b-versatile";

// --- Classify user intent ---

type UserAction = "greeting" | "search_events" | "book_ticket" | "check_calendar" | "general_question" | "confirm_booking" | "provide_email" | "cancel" | "book_anyway";

async function classifyAction(userMessage: string, isAwaitingConfirmation: boolean, isAwaitingEmail: boolean, isAwaitingBookAnyway: boolean): Promise<UserAction> {
  // Quick check: email in message while awaiting email OR even without awaiting
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const hasEmail = emailRegex.test(userMessage);
  const lower = userMessage.toLowerCase();
  
  // If message has an email and mentions sending/emailing (but NOT calendar/booking), treat as provide_email
  const isCalendarContext = lower.includes("calendar") || lower.includes("availability") || lower.includes("free slot");
  const isBookingContext = lower.includes("book") || lower.includes("ticket") || lower.includes("reserve");
  const wantsEmail = lower.includes("email it") || lower.includes("send it") || lower.includes("mail it") || lower.includes("email the") || lower.includes("send the") || lower.includes("mail the") || lower.includes("send to") || lower.includes("mail to") || lower.includes("email to") || /\bemail\b/.test(lower.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, ""));
  if (hasEmail && !isCalendarContext && !isBookingContext && (wantsEmail || isAwaitingEmail)) {
    return "provide_email";
  }

  if (isAwaitingEmail && !isCalendarContext && !isBookingContext) {
    if (hasEmail) return "provide_email";
    if (lower.includes("no") || lower.includes("skip") || lower.includes("later")) {
      state.awaitingEmail = false;
      state.lastBookingResult = null;
      return "general_question";
    }
  }

  // Handle "book anyway" after calendar conflict
  if (isAwaitingBookAnyway) {
    if (lower.includes("book anyway") || lower.includes("yes") || lower.includes("go ahead") || lower.includes("proceed") || lower.includes("ignore") || lower.includes("book it")) {
      return "book_anyway";
    }
    if (lower.includes("no") || lower.includes("cancel") || lower.includes("different") || lower.includes("alternative") || lower.includes("other")) {
      state.awaitingBookAnyway = false;
      state.pendingConflictBooking = null;
      return "search_events";
    }
  }

  const client = getLLMClient();
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      {
        role: "system",
        content: `You classify user messages into one action category. Respond with ONLY one of these exact strings, nothing else:
- "greeting" — user is saying hello, hi, hey, or making casual conversation
- "search_events" — user wants to find/see/discover events, shows, concerts, or asks what's available
- "book_ticket" — user explicitly wants to book/purchase/reserve tickets (mentions booking, names, specific events)
- "confirm_booking" — user is confirming a previous selection (saying yes, book it, go ahead, #1, #2, first, second)
- "provide_email" — user is providing an email address or asking to send/email booking confirmation
- "check_calendar" — user specifically asks about calendar availability
- "general_question" — user asks about how the agent works, what it can do, or other non-booking questions
- "cancel" — user wants to cancel, start over, or reset
${isAwaitingConfirmation ? "\nIMPORTANT: The agent just showed event options. If the user is selecting or confirming, classify as 'confirm_booking'." : ""}
${isAwaitingEmail ? "\nIMPORTANT: The agent just asked for an email. If the message contains an email address, classify as 'provide_email'." : ""}
${isAwaitingBookAnyway ? "\nIMPORTANT: The agent warned about a calendar conflict. If user says yes/go ahead/book anyway, classify as 'confirm_booking'. If they want alternatives, classify as 'search_events'." : ""}`,
      },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
    max_tokens: 20,
  });

  const action = (response.choices[0]?.message?.content || "general_question").trim().replace(/"/g, "").toLowerCase() as UserAction;
  const validActions: UserAction[] = ["greeting", "search_events", "book_ticket", "check_calendar", "general_question", "confirm_booking", "provide_email", "cancel", "book_anyway"];
  return validActions.includes(action) ? action : "general_question";
}

// --- Extract booking intent ---

async function extractIntent(userMessage: string): Promise<UserIntent> {
  const client = getLLMClient();
  try {
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: "You extract structured booking intent from user messages. Respond ONLY with valid JSON, no markdown, no code fences." },
        { role: "user", content: INTENT_EXTRACTION_PROMPT + userMessage },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    return {
      attendees: parsed.attendees || [],
      budget: parsed.budget ?? null,
      preferredDays: parsed.preferredDays || [],
      genres: parsed.genres || [],
      checkCalendar: parsed.checkCalendar ?? false,
      venuePreference: parsed.venuePreference || undefined,
      additionalNotes: parsed.additionalNotes || undefined,
    };
  } catch (error) {
    console.error("Intent extraction failed:", error);
    return { attendees: [{ name: "User" }], budget: null, preferredDays: [], genres: [], checkCalendar: false };
  }
}

// --- Generate conversational response ---

async function generateResponse(userMessage: string, conversationHistory: ChatMessage[], systemContext?: string): Promise<string> {
  const client = getLLMClient();
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory.slice(-10).map((msg) => ({ role: msg.role as "user" | "assistant", content: msg.content })),
    { role: "user", content: userMessage },
  ];
  if (systemContext) messages.push({ role: "system", content: systemContext });

  const response = await client.chat.completions.create({ model: LLM_MODEL, messages, temperature: 0.7, max_tokens: 1000 });
  return response.choices[0]?.message?.content || "I'm here to help you find and book event tickets!";
}

// --- Find event by name ---

function findEventByName(events: ScrapedEvent[], query: string): ScrapedEvent | null {
  const q = query.toLowerCase();
  for (const event of events) {
    if (q.includes(event.name.toLowerCase())) return event;
    if (event.name.toLowerCase().includes(q)) return event;
  }
  const words = q.split(/\s+/).filter((w) => w.length > 3);
  for (const event of events) {
    const eName = event.name.toLowerCase();
    if (words.some((w) => eName.includes(w))) return event;
  }
  return null;
}

// --- Extract email ---

function extractEmail(message: string): string | null {
  const match = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

// --- Extract emails from message for calendar ---

function extractEmails(message: string): string[] {
  const matches = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  return matches || [];
}

// --- Main Agent Handler ---

export async function handleMessage(
  userMessage: string,
  conversationHistory: ChatMessage[],
  userWallet?: string,
  clientBookingResult?: BookingResult,
  calendarToken?: string,
  attendeeEmails?: string[]
): Promise<{
  response: string;
  toolCalls: ToolCallResult[];
  tickets?: any[];
  events?: EventMatch[];
  walletAction?: any;
  pendingBooking?: any;
  bookingResult?: BookingResult | null;
  needsEmails?: boolean;
}> {
  const toolCalls: ToolCallResult[] = [];

  // Restore booking result from client if server state was lost (hot reload)
  if (clientBookingResult && !state.lastBookingResult) {
    console.log("[Agent] Restoring booking result from client state");
    state.lastBookingResult = clientBookingResult;
    state.awaitingEmail = true;
  }

  try {
    const action = await classifyAction(userMessage, state.awaitingConfirmation, state.awaitingEmail, state.awaitingBookAnyway);
    console.log(`[Agent] Classified action: ${action}`);

    switch (action) {
      case "greeting": {
        const response = await generateResponse(userMessage, conversationHistory);
        return { response, toolCalls };
      }
      case "general_question": {
        const response = await generateResponse(userMessage, conversationHistory,
          "Answer the user's question helpfully. You are TickClick, an AI ticketing agent that discovers events at KYD-powered venues (Le Poisson Rouge, DJ Mike Nasty), checks Google Calendar availability, and books real on-chain cNFT tickets on Solana devnet. Each booking mints a real compressed NFT and you can email booking confirmations."
        );
        return { response, toolCalls };
      }
      case "cancel": {
        resetAgentState();
        return { response: "No problem! I've cleared everything. What would you like to do next?", toolCalls: [] };
      }
      case "search_events":
        return await handleEventSearch(userMessage, conversationHistory, toolCalls);
      case "book_ticket":
        return await handleBookingRequest(userMessage, conversationHistory, toolCalls, userWallet, calendarToken, attendeeEmails);
      case "confirm_booking": {
        if (state.awaitingConfirmation && state.lastPresentedEvents.length > 0) {
          return await handleBookingConfirmation(userMessage, toolCalls, userWallet, calendarToken, attendeeEmails);
        }
        return await handleEventSearch(userMessage, conversationHistory, toolCalls);
      }
      case "book_anyway": {
        // User chose to book despite calendar conflict
        if (state.pendingConflictBooking) {
          const { event, attendees, userWallet: wallet } = state.pendingConflictBooking;
          state.awaitingBookAnyway = false;
          state.pendingConflictBooking = null;
          // Skip calendar check, go straight to payment
          return await proceedToPayment(event, attendees, toolCalls, wallet);
        }
        return { response: "No pending booking to confirm. Try searching for events first!", toolCalls: [] };
      }
      case "provide_email":
        return await handleEmailSend(userMessage, toolCalls);
      case "check_calendar": {
        const response = await generateResponse(userMessage, conversationHistory,
          "The user wants to check calendar availability. Let them know that if Google Calendar is connected, I'll automatically check everyone's calendars when they book tickets. They just need to include email addresses when booking (e.g., 'Book 2 tickets for me and akash@gmail.com')."
        );
        return { response, toolCalls };
      }
      default: {
        const response = await generateResponse(userMessage, conversationHistory);
        return { response, toolCalls };
      }
    }
  } catch (error: any) {
    console.error("[Agent] Error:", error);
    return { response: "Sorry, I hit a snag processing that. Could you try rephrasing?", toolCalls };
  }
}

// --- Handle Event Search (UNCHANGED) ---

async function handleEventSearch(userMessage: string, conversationHistory: ChatMessage[], toolCalls: ToolCallResult[]) {
  toolCalls.push({ tool: "discover_events", status: "running", summary: "Scanning KYD-powered venues for events..." });

  let events: ScrapedEvent[];
  try { events = await discoverEvents(); } catch { events = getStaticEventData(); }
  state.events = events;

  toolCalls[toolCalls.length - 1] = { tool: "discover_events", status: "completed", summary: `Found ${events.length} events across KYD venues`, data: { count: events.length } };

  const intent = await extractIntent(userMessage);
  let matches = matchEvents(events, intent, undefined);
  if (matches.length === 0) {
    matches = events.map((e, i) => ({ event: e, score: 50, rank: i + 1, reasons: ["Showing all available events"] }));
    console.log(`[Agent] No matches from filter — showing all ${events.length} events`);
  }
  state.matches = matches;
  state.lastPresentedEvents = matches;

  toolCalls.push({ tool: "match_events", status: "completed", summary: `${matches.length} event(s) match your criteria`, data: { matchCount: matches.length } });

  const matchSummary = formatMatchResults(matches);
  const response = await generateResponse(userMessage, conversationHistory,
    `Here are the REAL events found from KYD venues:\n\n${matchSummary}\n\nIMPORTANT RULES:\n- ONLY show events from the list above. NEVER invent or make up events.\n- If the list is empty or says "no matches", tell the user no events matched and suggest they try different criteria.\n- Do NOT fabricate event names, prices, dates, or venues.\n- The prices shown are REAL prices scraped from the venue websites. TRUST THEM. Do NOT override or change any price. If an event shows $10, it costs $10 — it is NOT free.\n- Do NOT claim any event is free unless the data explicitly shows "$0" or "FREE".\n- List EVERY event from the data — do not skip any. Number each (#1, #2, etc) and ask which to book.`
  );

  if (matches.length > 0) { state.awaitingConfirmation = true; state.intent = intent; }
  return { response, toolCalls, events: matches };
}

// --- Handle Booking Request ---

async function handleBookingRequest(userMessage: string, conversationHistory: ChatMessage[], toolCalls: ToolCallResult[], userWallet?: string, calendarToken?: string, attendeeEmails?: string[]) {
  toolCalls.push({ tool: "parse_intent", status: "running", summary: "Understanding your booking request..." });
  const intent = await extractIntent(userMessage);
  state.intent = intent;
  toolCalls[toolCalls.length - 1] = { tool: "parse_intent", status: "completed", summary: `Looking for ${intent.attendees.length} ticket(s)${intent.budget ? `, under $${intent.budget}` : ""}`, data: intent };

  // Extract emails from user message if provided
  const emailsFromMessage = extractEmails(userMessage);
  const allEmails = Array.from(new Set([...(attendeeEmails || []), ...emailsFromMessage]));

  toolCalls.push({ tool: "discover_events", status: "running", summary: "Scanning KYD-powered venues..." });
  let events: ScrapedEvent[];
  try { events = await discoverEvents(); } catch { events = getStaticEventData(); }
  state.events = events;
  toolCalls[toolCalls.length - 1] = { tool: "discover_events", status: "completed", summary: `Found ${events.length} events across KYD venues`, data: { count: events.length } };

  let freeSlots;
  if (intent.checkCalendar && intent.attendees.length > 0 && !calendarToken) {
    // Mock calendar if no Google Calendar connected
    toolCalls.push({ tool: "check_calendars", status: "running", summary: `Checking availability for ${intent.attendees.map((a) => a.name).join(" & ")}...` });
    const attendeeNames = intent.attendees.map((a) => a.name);
    const availability = getMockAvailability(attendeeNames);
    freeSlots = findOverlappingFreeSlots(availability, intent.preferredDays);
    toolCalls[toolCalls.length - 1] = { tool: "check_calendars", status: "completed", summary: `Found ${freeSlots.length} overlapping free slots`, data: { freeSlotCount: freeSlots.length } };
  }

  toolCalls.push({ tool: "match_events", status: "running", summary: "Finding the best matches..." });
  let matches = matchEvents(events, intent, freeSlots);
  if (matches.length === 0) {
    matches = events.map((e, i) => ({ event: e, score: 50, rank: i + 1, reasons: ["Showing all available events"] }));
    console.log(`[Agent] No matches from filter — showing all ${events.length} events`);
  }
  state.matches = matches;
  state.lastPresentedEvents = matches;
  toolCalls[toolCalls.length - 1] = { tool: "match_events", status: "completed", summary: `${matches.length} event(s) match your criteria`, data: { matchCount: matches.length } };

  const specificEvent = findEventByName(events, userMessage);
  if (specificEvent) {
    console.log(`[Agent] User named specific event: "${specificEvent.name}" — executing booking!`);
    return await executeAndRespond(specificEvent, intent.attendees, toolCalls, userWallet, calendarToken, allEmails);
  }

  const matchSummary = formatMatchResults(matches);
  const attendeeNames = intent.attendees.map((a) => a.name).join(" & ");
  const response = await generateResponse(userMessage, [],
    `Attendees: ${attendeeNames || "not specified"}\n\nHere are the matching events:\n${matchSummary}\n\nPresent ALL results with numbers (#1, #2, etc). Include all details. The prices shown are REAL and accurate — TRUST THEM. If an event shows $10, it costs $10, it is NOT free. Do NOT skip any events. Ask which event to book. Do NOT pretend to have booked anything.`
  );
  if (matches.length > 0) state.awaitingConfirmation = true;
  return { response, toolCalls, events: matches };
}

// --- Execute Booking and Build Response ---

async function executeAndRespond(
  event: ScrapedEvent, attendees: Attendee[], toolCalls: ToolCallResult[], userWallet?: string, calendarToken?: string, attendeeEmails?: string[]
): Promise<{ response: string; toolCalls: ToolCallResult[]; tickets?: any[]; walletAction?: any; pendingBooking?: any; bookingResult?: BookingResult | null; needsEmails?: boolean }> {
  if (attendees.length === 0) attendees = [{ name: "User" }];

  // ── Google Calendar check (before payment) ──
  if (calendarToken && attendeeEmails && attendeeEmails.length > 0 && event.date && event.time) {
    toolCalls.push({ tool: "check_calendars", status: "running", summary: `Checking Google Calendar for ${attendeeEmails.length} attendee(s)...` });

    const calResult = await checkCalendarForEvent(
      calendarToken,
      attendeeEmails,
      event.date,
      event.time,
      event.dayOfWeek
    );

    if (calResult.success) {
      toolCalls[toolCalls.length - 1] = {
        tool: "check_calendars",
        status: "completed",
        summary: calResult.allFree
          ? `All ${attendeeEmails.length} attendee(s) are free ✅`
          : `Calendar conflict detected 🔴`,
      };

      if (!calResult.allFree) {
        // Calendar conflict — warn user, ask to proceed or pick alternative
        const calendarMsg = formatCalendarResults(calResult);

        state.awaitingBookAnyway = true;
        state.awaitingConfirmation = false;
        state.pendingConflictBooking = { event, attendees, userWallet };

        return {
          response: `${calendarMsg}\n\n**${event.name}** is on **${event.dayOfWeek}, ${event.date} at ${event.time}**.\n\nWould you like to:\n1. **Book anyway** (ignore the conflict)\n2. **Pick a different event** (I'll find one when everyone's free)`,
          toolCalls,
        };
      }

      // All free — continue to payment with confirmation
      toolCalls.push({
        tool: "calendar_clear",
        status: "completed",
        summary: `All attendees confirmed free for ${event.dayOfWeek}, ${event.date} at ${event.time}`,
      });
    } else {
      // Calendar check failed — proceed anyway
      toolCalls[toolCalls.length - 1] = {
        tool: "check_calendars",
        status: "completed",
        summary: `Calendar check skipped: ${calResult.error}`,
      };
    }
  }

  // ── Proceed to payment ──
  return await proceedToPayment(event, attendees, toolCalls, userWallet);
}

// --- Proceed to Payment (Phantom or server-side) ---

async function proceedToPayment(
  event: ScrapedEvent, attendees: Attendee[], toolCalls: ToolCallResult[], userWallet?: string
): Promise<{ response: string; toolCalls: ToolCallResult[]; tickets?: any[]; walletAction?: any; pendingBooking?: any; bookingResult?: BookingResult | null }> {

  // Build calendar status message if we checked
  const calendarNote = toolCalls.some((tc) => tc.tool === "calendar_clear")
    ? `\n\n✅ **Calendar check:** All attendees are free at event time!\n`
    : "";

  // ── Phantom wallet connected → require wallet confirmation ──
  if (userWallet) {
    const isFree = event.isFree || event.price === 0;

    if (isFree) {
      const confirmMessage = [
        `TickClick Booking Confirmation`,
        `Event: ${event.name}`,
        `Venue: ${event.venue}`,
        `Attendees: ${attendees.map((a) => a.name).join(", ")}`,
        `Wallet: ${userWallet}`,
        `Timestamp: ${new Date().toISOString()}`,
      ].join("\n");

      toolCalls.push({ tool: "wallet_confirmation", status: "completed", summary: "Requesting wallet signature for free ticket booking" });

      return {
        response: `🎟️ **Ready to book ${attendees.length} ticket(s) for "${event.name}"!**${calendarNote}\n\nThis is a **free event** — no payment required. Please sign the confirmation message in your Phantom wallet to proceed.\n\n*Your wallet will be asked to sign a message (no SOL will be charged).*`,
        toolCalls,
        walletAction: { type: "sign_message", message: confirmMessage },
        pendingBooking: { event, attendees },
      };
    } else {
      const solAmount = calculateDevnetSol(event.price);
      const venueWallet = process.env.VENUE_WALLET_PUBLIC_KEY || "AMowwS1iaoKZMMwJxWY5jdeCKukbm64XyZEg8fwbXCPw";

      toolCalls.push({ tool: "wallet_payment", status: "completed", summary: `Requesting ${solAmount} SOL payment for $${event.price} ticket` });

      return {
        response: `🎟️ **Ready to book ${attendees.length} ticket(s) for "${event.name}"!**${calendarNote}\n\n**Ticket Price:** $${event.price} per ticket\n**Devnet Payment:** ${solAmount} SOL per ticket (${(solAmount * attendees.length).toFixed(6)} SOL total)\n\nPlease approve the payment in your Phantom wallet.\n\n*This is a devnet transaction — no real funds are used.*`,
        toolCalls,
        walletAction: {
          type: "transfer_sol",
          amount: solAmount * attendees.length,
          recipient: venueWallet,
          description: `${attendees.length}x ${event.name} — $${event.price * attendees.length} (${(solAmount * attendees.length).toFixed(6)} SOL devnet)`,
        },
        pendingBooking: { event, attendees },
      };
    }
  }

  // ── No wallet → auto-execute (venue pays) ──
  toolCalls.push({ tool: "execute_booking", status: "running", summary: `Booking "${event.name}" for ${attendees.map((a) => a.name).join(" & ")}...` });

  let result;
  if (process.env.MERKLE_TREE_ADDRESS && process.env.USER_WALLET_PUBLIC_KEY) {
    console.log(`[Agent] MERKLE_TREE_ADDRESS found — calling executeBooking() for REAL minting`);
    result = await executeBooking({ event, attendees, fanWalletAddress: process.env.USER_WALLET_PUBLIC_KEY || "" });
  } else {
    console.log(`[Agent] No MERKLE_TREE_ADDRESS — falling back to simulation`);
    result = simulateBooking(event, attendees);
  }

  toolCalls[toolCalls.length - 1] = {
    tool: "execute_booking",
    status: result.success ? "completed" : "error",
    summary: result.success ? `Booked ${result.tickets.length} ticket(s) on Solana!` : `Booking failed: ${result.error}`,
    data: result,
  };

  let response = formatBookingResult(result);
  if (result.success) {
    state.lastBookingResult = result;
    state.awaitingEmail = true;
    response += `\n\n📧 **Would you like me to email the booking confirmation?** Just share your email address and I'll send you all the ticket details, transaction hashes, and Solana Explorer links.`;
  }
  state.awaitingConfirmation = false;

  return { response, toolCalls, tickets: result.tickets, bookingResult: result.success ? result : null };
}

// --- Handle Booking Confirmation ---

async function handleBookingConfirmation(userMessage: string, toolCalls: ToolCallResult[], userWallet?: string, calendarToken?: string, attendeeEmails?: string[]) {
  const message = userMessage.toLowerCase();
  let selectedIndex = -1;

  if (message.includes("#1") || message.includes("first") || message === "1" || message.includes("yes") || message.includes("book it") || message.includes("go ahead") || message.includes("confirm")) selectedIndex = 0;
  else if (message.includes("#2") || message === "2" || message.includes("second")) selectedIndex = 1;
  else if (message.includes("#3") || message === "3" || message.includes("third")) selectedIndex = 2;
  else if (message.includes("#4") || message === "4" || message.includes("fourth")) selectedIndex = 3;
  else if (message.includes("#5") || message === "5" || message.includes("fifth")) selectedIndex = 4;
  else if (message.includes("#6") || message === "6") selectedIndex = 5;
  else if (message.includes("#7") || message === "7") selectedIndex = 6;
  else if (message.includes("#8") || message === "8") selectedIndex = 7;
  else if (message.includes("#9") || message === "9") selectedIndex = 8;
  else if (message.includes("#10") || message === "10") selectedIndex = 9;

  if (selectedIndex < 0 || selectedIndex >= state.lastPresentedEvents.length) {
    return { response: `I have ${state.lastPresentedEvents.length} event(s) listed. Which one? Say "book #1", "book #2", etc.`, toolCalls: [] };
  }

  const selectedMatch = state.lastPresentedEvents[selectedIndex];
  const attendees = state.intent?.attendees || [{ name: "User" }];

  // Extract any emails from the current or previous messages
  const emailsFromMessage = extractEmails(userMessage);
  const allEmails = Array.from(new Set([...(attendeeEmails || []), ...emailsFromMessage]));

  return await executeAndRespond(selectedMatch.event, attendees, toolCalls, userWallet, calendarToken, allEmails);
}

// --- Handle Email Send (UNCHANGED) ---

async function handleEmailSend(userMessage: string, toolCalls: ToolCallResult[]) {
  const email = extractEmail(userMessage);
  if (!email) return { response: "I couldn't find a valid email address in your message. Could you share your email? (e.g., name@gmail.com)", toolCalls: [] };
  
  if (!state.lastBookingResult) {
    console.log("[Agent] No booking result in server state — email cannot be sent");
    return { response: "I don't have a recent booking to email. Book some tickets first, then I'll send the confirmation!", toolCalls: [] };
  }

  console.log(`[Agent] Sending booking confirmation to: ${email}`);
  toolCalls.push({ tool: "send_email", status: "running", summary: `Sending booking confirmation to ${email}...` });

  const emailResult = await sendBookingEmail({
    to: email,
    bookingResult: state.lastBookingResult,
    merkleTreeAddress: process.env.MERKLE_TREE_ADDRESS || "Not configured",
    userWalletAddress: process.env.USER_WALLET_PUBLIC_KEY || "Not configured",
    venueWalletAddress: process.env.VENUE_WALLET_PUBLIC_KEY || "AMowwS1iaoKZMMwJxWY5jdeCKukbm64XyZEg8fwbXCPw",
  });

  if (emailResult.success) {
    toolCalls[toolCalls.length - 1] = { tool: "send_email", status: "completed", summary: `Booking confirmation sent to ${email}!` };
    state.awaitingEmail = false;
    state.lastBookingResult = null;
    return { response: `📧 **Booking confirmation sent to ${email}!**\n\nThe email includes all your ticket details, transaction hashes, wallet addresses, and Solana Explorer links. Check your inbox (and spam folder just in case).\n\nAnything else I can help with?`, toolCalls };
  } else {
    toolCalls[toolCalls.length - 1] = { tool: "send_email", status: "error", summary: `Failed to send email: ${emailResult.error}` };
    return { response: `❌ Sorry, I couldn't send the email: ${emailResult.error}\n\nYou can try again with a different email, or I can help you with something else.`, toolCalls };
  }
}

// --- Execute Pending Booking (after Phantom wallet confirmation — UNCHANGED) ---

export async function executePendingBooking(
  event: ScrapedEvent, attendees: Attendee[], userWallet: string, paymentTxHash?: string
): Promise<{ response: string; toolCalls: ToolCallResult[]; tickets?: any[]; bookingResult?: BookingResult | null }> {
  const toolCalls: ToolCallResult[] = [];

  console.log(`\n[Agent] Executing pending booking after wallet confirmation`);
  console.log(`   Event: ${event.name}`);
  console.log(`   Wallet: ${userWallet}`);
  console.log(`   Payment Tx: ${paymentTxHash || "N/A (free)"}`);

  toolCalls.push({ tool: "execute_booking", status: "running", summary: `Minting cNFT tickets for "${event.name}"...` });

  let result;
  if (process.env.MERKLE_TREE_ADDRESS) {
    result = await executeBooking({ event, attendees, fanWalletAddress: userWallet });
  } else {
    result = simulateBooking(event, attendees);
  }

  toolCalls[toolCalls.length - 1] = {
    tool: "execute_booking",
    status: result.success ? "completed" : "error",
    summary: result.success ? `Minted ${result.tickets.length} cNFT ticket(s) on Solana!` : `Booking failed: ${result.error}`,
    data: result,
  };

  let response = formatBookingResult(result);
  if (paymentTxHash && result.success) {
    response += `\n\n💳 **Your payment:** [View on Explorer](https://explorer.solana.com/tx/${paymentTxHash}?cluster=devnet)`;
  }
  if (result.success) {
    state.lastBookingResult = result;
    state.awaitingEmail = true;
    response += `\n\n📧 **Would you like me to email the booking confirmation?** Just share your email address and I'll send you all the ticket details, transaction hashes, and Solana Explorer links.`;
  }

  return { response, toolCalls, tickets: result.tickets, bookingResult: result.success ? result : null };
}

// --- Reset ---

export function resetAgentState() {
  state.events = [];
  state.matches = [];
  state.intent = null;
  state.awaitingConfirmation = false;
  state.lastPresentedEvents = [];
  state.awaitingEmail = false;
  state.lastBookingResult = null;
  state.awaitingBookAnyway = false;
  state.pendingConflictBooking = null;
}