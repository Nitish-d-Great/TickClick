// =============================================
// TickClick — Conversational AI Ticket Agent
// Uses LLM to decide actions dynamically
// Executes REAL Solana transactions when configured
// Sends booking confirmation emails via Resend
// Supports Phantom wallet for user-signed bookings
// Google Calendar integration for availability check
// Audius music discovery for event-related tracks
// =============================================

import OpenAI from "openai";
import { INTENT_EXTRACTION_PROMPT, getSystemPrompt, buildPromptContext } from "./prompts/system";
import { discoverEvents, getStaticEventData } from "./tools/scrapeEvents";
import {
  getMockAvailability,
  findOverlappingFreeSlots,
  checkCalendarForEvent,
  formatCalendarResults,
  createCalendarEvent,
} from "./tools/checkCalendar";
import { matchEvents, formatMatchResults } from "./tools/matchEvents";
import {
  executeBooking,
  simulateBooking,
  formatBookingResult,
} from "./tools/executeBooking";
import { sendBookingEmail } from "@/lib/email";
import { discoverMusicForEvent, AUDIUS_GENRES } from "@/lib/audius";
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
    calendarToken?: string;
    attendeeEmails?: string[];
  } | null;
  // Workflow enforcement flags
  calendarChecked: boolean;
  paymentConfirmed: boolean;
  bookingExecuted: boolean;
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
  calendarChecked: false,
  paymentConfirmed: false,
  bookingExecuted: false,
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

type UserAction = "greeting" | "search_events" | "book_ticket" | "check_calendar" | "general_question" | "confirm_booking" | "provide_email" | "cancel" | "book_anyway" | "discover_music";

async function classifyAction(userMessage: string, isAwaitingConfirmation: boolean, isAwaitingEmail: boolean, isAwaitingBookAnyway: boolean): Promise<UserAction> {
  // Quick check: email in message while awaiting email OR even without awaiting
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const hasEmail = emailRegex.test(userMessage);
  const lower = userMessage.toLowerCase();

  // If message has an email and mentions sending/emailing, treat as provide_email
  const isCalendarContext = lower.includes("calendar") || lower.includes("availability") || lower.includes("free slot");
  // Use word-boundary regex to avoid "gmail" matching "mail"
  const wantsEmail = /\bsend\b/.test(lower) || /\bmail\b/.test(lower) || /\bemail\b/.test(lower) || /\bconfirmation\b/.test(lower);
  
  // KEY FIX: If user has an email AND wants to send something (confirmation, booking details, etc.)
  // this is ALWAYS provide_email — even if the word "booking" appears.
  // "Send the confirmation of booking on xyz@gmail.com" is an email request, NOT a new booking.
  if (hasEmail && !isCalendarContext && wantsEmail) {
    return "provide_email";
  }

  // Also catch: awaiting email + user provides one (regardless of other keywords)
  if (isAwaitingEmail && hasEmail && !isCalendarContext) {
    return "provide_email";
  }

  if (isAwaitingEmail && !isCalendarContext) {
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

  // Quick detect: music/Audius requests (only when NOT in a booking flow)
  const musicKeywords = ["music", "listen", "play", "song", "track", "audius", "artist", "tune", "vibe", "playlist"];
  if (musicKeywords.some((kw) => lower.includes(kw)) && !lower.includes("book") && !lower.includes("ticket")) {
    return "discover_music";
  }

  const client = getLLMClient();
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      {
        role: "system",
        content: `You classify user messages into one action category. Respond with ONLY one of these exact strings, nothing else:
- "greeting" — user is saying hello, hi, hey, thank you or making casual conversation
- "search_events" — user wants to find/see/discover events, shows, concerts, or asks what's available based on his specified conditions
- "book_ticket" — user explicitly wants to book/purchase/reserve tickets (mentions event name, user names, specific events)
- "confirm_booking" — user is confirming a previous selection (saying yes, book it, go ahead, #1, #2, first, second) or explicitly naming the event whose ticket has to be booked
- "provide_email" — user is asking to send/email booking confirmation and sending a gmail address
- "check_calendar" — user specifically asks about calendar availability
- "discover_music" — user wants to hear music, listen to an artist, find tracks, or asks about Audius
- "general_question" — user asks about how the agent works, what it can do, or other non-booking questions
- "cancel" — user wants to cancel, start over, or reset
${isAwaitingConfirmation ? "\nIMPORTANT: The agent just showed event options. If the user is selecting or confirming by saying book tickets, classify as 'confirm_booking'." : ""}
${isAwaitingEmail ? "\nIMPORTANT: The agent just asked for an email. If the message says to send booking confirmation to given email, classify as 'provide_email'." : ""}
${isAwaitingBookAnyway ? "\nIMPORTANT: The agent warned about a calendar conflict. If user says yes/go ahead/book anyway, classify as 'book_anyway'. If they want alternatives, classify as 'search_events'." : ""}`,
      },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
    max_tokens: 20,
  });

  const action = (response.choices[0]?.message?.content || "general_question").trim().replace(/"/g, "").toLowerCase() as UserAction;
  const validActions: UserAction[] = ["greeting", "search_events", "book_ticket", "check_calendar", "general_question", "confirm_booking", "provide_email", "cancel", "book_anyway", "discover_music"];
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

// --- Generate conversational response (now uses DYNAMIC system prompt) ---

async function generateResponse(
  userMessage: string,
  conversationHistory: ChatMessage[],
  systemContext?: string,
  promptContext?: { calendarToken?: string; calendarEmail?: string; walletAddress?: string }
): Promise<string> {
  const client = getLLMClient();

  // Build the dynamic system prompt with current connection state
  const dynamicPrompt = getSystemPrompt(
    buildPromptContext({
      calendarToken: promptContext?.calendarToken,
      calendarEmail: promptContext?.calendarEmail,
      walletAddress: promptContext?.walletAddress,
    })
  );

  const messages: any[] = [
    { role: "system", content: dynamicPrompt },
    ...conversationHistory.slice(-10).map((msg) => ({ role: msg.role as "user" | "assistant", content: msg.content })),
    { role: "user", content: userMessage },
  ];
  if (systemContext) messages.push({ role: "system", content: systemContext });

  const response = await client.chat.completions.create({ model: LLM_MODEL, messages, temperature: 0.7, max_tokens: 1000 });
  return response.choices[0]?.message?.content || "I'm here to help you find and book event tickets!";
}

// --- Infer genre via LLM (for Audius discovery) ---

async function inferGenre(artistName: string, eventName: string, venueName: string): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) return "Electronic";

  try {
    const genreList = AUDIUS_GENRES.join(", ");
    const client = getLLMClient();
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a music genre classifier. Given an artist name and/or event name, respond with exactly ONE genre from this list: ${genreList}. Respond with ONLY the genre name, nothing else.`,
        },
        {
          role: "user",
          content: `Artist: "${artistName}", Event: "${eventName}", Venue: "${venueName}"`,
        },
      ],
      temperature: 0,
      max_tokens: 20,
    });

    const genre = response.choices[0]?.message?.content?.trim() || "Electronic";
    const validGenre = AUDIUS_GENRES.find((g) => g.toLowerCase() === genre.toLowerCase());
    if (validGenre) return validGenre;

    const partialMatch = AUDIUS_GENRES.find(
      (g) => g.toLowerCase().includes(genre.toLowerCase()) || genre.toLowerCase().includes(g.toLowerCase())
    );
    return partialMatch || "Electronic";
  } catch {
    return "Electronic";
  }
}

// --- Find event by name ---

function findEventByName(events: ScrapedEvent[], query: string): ScrapedEvent | null {
  const q = query.toLowerCase();

  // Pass 1: Check if the full event name appears in the query (or vice versa)
  for (const event of events) {
    if (q.includes(event.name.toLowerCase())) return event;
    if (event.name.toLowerCase().includes(q)) return event;
  }

  // Pass 2: Score each event by how many meaningful words match
  // Filter out generic stopwords that would cause false positives
  const STOPWORDS = new Set([
    "book", "booking", "tickets", "ticket", "event", "events", "name",
    "want", "need", "please", "could", "would", "like", "some", "with",
    "from", "that", "this", "have", "will", "your", "about", "them",
    "show", "find", "free", "paid", "price", "under", "over", "cheap",
    "best", "good", "near", "next", "last", "first", "second", "third",
    "email", "gmail", "send", "mail", "confirmation",
    "the", "and", "for", "com", "org", "net", // common noise words
  ]);

  const words = q
    .replace(/[()'".,@]/g, " ")       // strip punctuation
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w)); // min 4 chars to skip "the", "and", etc.

  let bestMatch: ScrapedEvent | null = null;
  let bestScore = 0;

  for (const event of events) {
    const eName = event.name.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (eName.includes(word)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = event;
    }
  }

  // Require at least 1 meaningful word match to avoid random picks
  return bestScore >= 1 ? bestMatch : null;
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
  audiusData?: any;
}> {
  const toolCalls: ToolCallResult[] = [];

  // Build prompt context for dynamic system prompt
  const promptCtx = {
    calendarToken,
    calendarEmail: attendeeEmails?.[0],
    walletAddress: userWallet,
  };

  // ALWAYS restore booking result from client — server state is unreliable
  // (Next.js serverless functions / hot reloads wipe module-level state)
  if (clientBookingResult) {
    console.log("[Agent] Restoring booking result from client state");
    state.lastBookingResult = clientBookingResult;
    state.awaitingEmail = true;
  }

  try {
    const action = await classifyAction(userMessage, state.awaitingConfirmation, state.awaitingEmail, state.awaitingBookAnyway);
    console.log(`[Agent] Classified action: ${action}`);

    switch (action) {
      case "greeting": {
        const response = await generateResponse(userMessage, conversationHistory, undefined, promptCtx);
        return { response, toolCalls };
      }
      case "general_question": {
        const response = await generateResponse(userMessage, conversationHistory,
          "Answer the user's question helpfully. You are TickClick, an AI ticketing agent that discovers events at KYD-powered venues (Le Poisson Rouge, DJ Mike Nasty), checks Google Calendar availability, asks user for payment (for paid events) or message signature (for free event) and books real on-chain cNFT tickets on Solana devnet. Each booking mints a real compressed NFT and you can email booking confirmations. You also integrate with Audius for music discovery — users can listen to tracks related to events they're interested in.",
          promptCtx
        );
        return { response, toolCalls };
      }
      case "cancel": {
        resetAgentState();
        return { response: "No problem! I've cleared everything. What would you like to do next?", toolCalls: [] };
      }
      case "search_events":
        return await handleEventSearch(userMessage, conversationHistory, toolCalls, calendarToken, promptCtx);
      case "book_ticket": {
        // Reset workflow flags for new booking attempt
        // BUT preserve email state (lastBookingResult, awaitingEmail) in case user is mid-email-flow
        state.calendarChecked = false;
        state.paymentConfirmed = false;
        state.bookingExecuted = false;
        return await handleBookingRequest(userMessage, conversationHistory, toolCalls, userWallet, calendarToken, attendeeEmails, promptCtx);
      }
      case "confirm_booking": {
        if (state.awaitingConfirmation && state.lastPresentedEvents.length > 0) {
          // Reset workflow flags for new booking attempt
          state.calendarChecked = false;
          state.paymentConfirmed = false;
          state.bookingExecuted = false;
          return await handleBookingConfirmation(userMessage, toolCalls, userWallet, calendarToken, attendeeEmails);
        }
        return await handleEventSearch(userMessage, conversationHistory, toolCalls, calendarToken, promptCtx);
      }
      case "book_anyway": {
        // User chose to book despite calendar conflict
        if (state.pendingConflictBooking) {
          const { event, attendees, userWallet: wallet } = state.pendingConflictBooking;
          state.awaitingBookAnyway = false;
          state.pendingConflictBooking = null;
          state.calendarChecked = true; // User acknowledged conflict
          // Skip calendar check, go straight to payment
          return await proceedToPayment(event, attendees, toolCalls, wallet, calendarToken, attendeeEmails);
        }
        return { response: "No pending booking to confirm. Try searching for events first!", toolCalls: [] };
      }
      case "provide_email":
        return await handleEmailSend(userMessage, toolCalls);
      case "discover_music":
        return await handleMusicDiscovery(userMessage, conversationHistory, toolCalls, promptCtx);
      case "check_calendar": {
        const response = await generateResponse(userMessage, conversationHistory,
          "The user wants to check calendar availability. Let them know that if Google Calendar is connected, I'll automatically check everyone's calendars when they book tickets. They just need to include email addresses when booking (e.g., 'Book 2 tickets for Aman (abc@gmail.com) and Akash (akash@gmail.com)').",
          promptCtx
        );
        return { response, toolCalls };
      }
      default: {
        const response = await generateResponse(userMessage, conversationHistory, undefined, promptCtx);
        return { response, toolCalls };
      }
    }
  } catch (error: any) {
    console.error("[Agent] Error:", error);
    return { response: "Sorry, I hit a snag processing that. Could you try rephrasing?", toolCalls };
  }
}

// --- Handle Event Search ---

async function handleEventSearch(
  userMessage: string,
  conversationHistory: ChatMessage[],
  toolCalls: ToolCallResult[],
  calendarToken?: string,
  promptCtx?: { calendarToken?: string; calendarEmail?: string; walletAddress?: string }
) {
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
  const calendarNote = calendarToken
    ? `\n- Google Calendar IS connected. Remind the user that calendars will be checked automatically before booking.\n`
    : "";

  const response = await generateResponse(userMessage, conversationHistory,
    `Here are the REAL events found from KYD venues:\n\n${matchSummary}\n\n` +
    `STRICT RULES — VIOLATIONS WILL BREAK THE APP:\n` +
    `- ONLY show events from the list above. NEVER invent or make up events.\n` +
    `- If the list is empty or says "no matches", tell the user no events matched and suggest they try different criteria.\n` +
    `- Do NOT fabricate event names, prices, dates, or venues.\n` +
    `- The prices shown are REAL prices scraped from the venue websites. TRUST THEM. Do NOT override or change any price. If an event shows $10, it costs $10 — it is NOT free. RSVP events might not be free.\n` +
    `- Do NOT claim any event is free unless the data explicitly shows "$0" or "FREE".\n` +
    `- List EVERY event from the data — do not skip any. Number each (#1, #2, etc) and ask which to book.\n` +
    `- Do NOT say "Booking Confirmed" or "Tickets booked" or anything implying a booking happened.\n` +
    `- You are ONLY presenting options right now. The user must select one first.\n` +
    `- Mention that users can explore related music on Audius for any event they're interested in.\n` +
    calendarNote,
    promptCtx
  );

  if (matches.length > 0) { state.awaitingConfirmation = true; state.intent = intent; }
  return { response, toolCalls, events: matches };
}

// --- Handle Booking Request ---

async function handleBookingRequest(
  userMessage: string,
  conversationHistory: ChatMessage[],
  toolCalls: ToolCallResult[],
  userWallet?: string,
  calendarToken?: string,
  attendeeEmails?: string[],
  promptCtx?: { calendarToken?: string; calendarEmail?: string; walletAddress?: string }
) {
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
  const calendarNote = calendarToken
    ? `\n- Google Calendar IS connected. IMPORTANT: Calendar will be checked BEFORE any payment is requested. This is enforced by code.\n`
    : "";

  const response = await generateResponse(userMessage, [],
    `Attendees: ${attendeeNames || "not specified"}\n\nHere are the matching events:\n${matchSummary}\n\n` +
    `STRICT RULES — VIOLATIONS WILL BREAK THE APP:\n` +
    `- Present ALL results with numbers (#1, #2, etc). Include all details.\n` +
    `- The prices shown are REAL and accurate — TRUST THEM. If an event shows $10, it costs $10, it is NOT free.\n` +
    `- Do NOT skip any events.\n` +
    `- Ask which event to book.\n` +
    `- Do NOT pretend to have booked anything.\n` +
    `- Do NOT say "Booking Confirmed" or "Tickets booked" or anything implying a booking happened.\n` +
    `- You are ONLY presenting options. The user must select one, then pay via wallet.\n` +
    `- Do NOT skip the payment step. Do NOT skip the calendar check step.\n` +
    calendarNote,
    promptCtx
  );
  if (matches.length > 0) state.awaitingConfirmation = true;
  return { response, toolCalls, events: matches };
}

// --- Handle Music Discovery (Audius integration) ---

async function handleMusicDiscovery(
  userMessage: string,
  conversationHistory: ChatMessage[],
  toolCalls: ToolCallResult[],
  promptCtx?: { calendarToken?: string; calendarEmail?: string; walletAddress?: string }
): Promise<{
  response: string;
  toolCalls: ToolCallResult[];
  audiusData?: any;
}> {
  const lower = userMessage.toLowerCase();

  // Try to extract an artist name or genre from the message
  let artistName = "";
  let eventName = "";
  let venueName = "";

  // If we have events loaded, try to match against them
  if (state.events.length > 0) {
    const matchedEvent = findEventByName(state.events, userMessage);
    if (matchedEvent) {
      artistName = matchedEvent.name;
      eventName = matchedEvent.name;
      venueName = matchedEvent.venue;
    }
  }

  // If no event match, use the user message as the artist/query
  if (!artistName) {
    // Strip common music request prefixes
    artistName = lower
      .replace(/play|listen to|find music|search for|tracks by|songs by|audius|music|for|by|from/gi, "")
      .trim();
    if (!artistName) artistName = "Electronic"; // fallback
  }

  toolCalls.push({
    tool: "audius_discover",
    status: "running",
    summary: `Searching Audius for "${artistName}"...`,
  });

  try {
    // Infer genre for fallback
    const genre = await inferGenre(artistName, eventName, venueName);

    // Discover music
    const result = await discoverMusicForEvent(artistName, genre);

    toolCalls[toolCalls.length - 1] = {
      tool: "audius_discover",
      status: "completed",
      summary:
        result.tracks.length > 0
          ? `Found ${result.tracks.length} tracks ${result.source === "artist_match" ? `by ${result.artist?.name}` : `in ${result.genre}`} on Audius`
          : "No tracks found on Audius",
      data: { trackCount: result.tracks.length, source: result.source, genre: result.genre },
    };

    if (result.tracks.length > 0) {
      let response = "";
      if (result.source === "artist_match" && result.artist) {
        response = `🎵 **Found ${result.artist.name} on Audius!**${result.artist.isVerified ? " ✅" : ""}\n\n`;
        response += `${result.artist.followerCount.toLocaleString()} followers · ${result.artist.trackCount} tracks\n\n`;
        response += `**Top Tracks:**\n`;
      } else {
        response = `🎵 **Trending ${result.genre} tracks on Audius:**\n\n`;
      }

      result.tracks.forEach((track, i) => {
        const mins = Math.floor(track.duration / 60);
        const secs = track.duration % 60;
        response += `${i + 1}. **${track.title}** by ${track.artistName} (${mins}:${secs.toString().padStart(2, "0")})\n`;
        response += `   ${track.playCount.toLocaleString()} plays · [Listen on Audius](https://audius.co${track.permalink})\n\n`;
      });

      if (result.audiusProfileUrl) {
        response += `\n🔗 [View full profile on Audius](${result.audiusProfileUrl})`;
      }

      response += `\n\nWant me to find events to attend? Just say "show me events"!`;

      return { response, toolCalls, audiusData: result };
    } else {
      const response = `I couldn't find tracks matching "${artistName}" on Audius right now. Try a different artist name or genre, or I can show you events instead!`;
      return { response, toolCalls, audiusData: result };
    }
  } catch (error: any) {
    console.error("[Agent] Audius discovery error:", error);
    toolCalls[toolCalls.length - 1] = {
      tool: "audius_discover",
      status: "error",
      summary: `Audius search failed: ${error.message}`,
    };
    return {
      response: "I had trouble connecting to Audius right now. Want me to help you find events instead?",
      toolCalls,
    };
  }
}

// --- Execute Booking and Build Response ---

async function executeAndRespond(
  event: ScrapedEvent, attendees: Attendee[], toolCalls: ToolCallResult[], userWallet?: string, calendarToken?: string, attendeeEmails?: string[]
): Promise<{ response: string; toolCalls: ToolCallResult[]; tickets?: any[]; walletAction?: any; pendingBooking?: any; bookingResult?: BookingResult | null; needsEmails?: boolean }> {
  if (attendees.length === 0) attendees = [{ name: "User" }];

  // ══════════════════════════════════════════════════════════════
  // STEP 4 ENFORCED: Google Calendar check (code-gated, NOT LLM-decided)
  // This runs BEFORE any payment/booking regardless of LLM behavior
  // ══════════════════════════════════════════════════════════════
  if (calendarToken) {
    // Calendar IS connected — we MUST check it before proceeding

    if (!attendeeEmails || attendeeEmails.length === 0) {
      // Calendar connected but no emails — ASK for them, don't silently skip
      console.log("[Agent] Calendar connected but no attendee emails — requesting emails");
      return {
        response: `📅 **Google Calendar is connected** — I need attendee email addresses to check for conflicts before booking.\n\nPlease share the email(s) for your group so I can verify everyone's free for **${event.name}** on **${event.dayOfWeek || ""} ${event.date || ""} ${event.time || ""}**.\n\n*Example: "My email is abc@gmail.com and my friend's is xyz@gmail.com"*`,
        toolCalls,
        needsEmails: true,
      };
    }

    if (event.date && event.time) {
      // We have everything needed — run the calendar check
      toolCalls.push({ tool: "check_calendars", status: "running", summary: `Checking Google Calendar for ${attendeeEmails.length} attendee(s)...` });

      const calResult = await checkCalendarForEvent(
        calendarToken,
        attendeeEmails,
        event.date,
        event.time,
        event.dayOfWeek
      );

      state.calendarChecked = true; // ← Mark as checked regardless of result

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

        // All free — add confirmation tool call and continue to payment
        toolCalls.push({
          tool: "calendar_clear",
          status: "completed",
          summary: `All attendees confirmed free for ${event.dayOfWeek}, ${event.date} at ${event.time}`,
        });
      } else {
        // Calendar API call failed — log it, proceed anyway
        toolCalls[toolCalls.length - 1] = {
          tool: "check_calendars",
          status: "completed",
          summary: `Calendar check failed: ${calResult.error} — proceeding anyway`,
        };
      }
    } else {
      // No date/time on event — can't check calendar, log explicitly
      toolCalls.push({
        tool: "check_calendars",
        status: "completed",
        summary: `Calendar check skipped: event date/time not available in scraped data`,
      });
      state.calendarChecked = true;
    }
  } else {
    // No calendar connected — mark as N/A and proceed
    state.calendarChecked = true;

    // WARN if user provided emails (they likely expect calendar check)
    if (attendeeEmails && attendeeEmails.length > 0) {
      console.log("[Agent] ⚠️ User provided emails but Google Calendar is NOT connected — skipping calendar check");
      toolCalls.push({
        tool: "check_calendars",
        status: "completed",
        summary: `⚠️ Calendar not connected — connect Google Calendar to check conflicts before booking`,
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 6: Proceed to payment (only after calendar check passed/skipped)
  // ══════════════════════════════════════════════════════════════
  return await proceedToPayment(event, attendees, toolCalls, userWallet, calendarToken, attendeeEmails);
}

// --- Proceed to Payment (Phantom or server-side) ---

async function proceedToPayment(
  event: ScrapedEvent, attendees: Attendee[], toolCalls: ToolCallResult[], userWallet?: string,
  calendarToken?: string, attendeeEmails?: string[]
): Promise<{ response: string; toolCalls: ToolCallResult[]; tickets?: any[]; walletAction?: any; pendingBooking?: any; bookingResult?: BookingResult | null }> {

  // SAFETY: Log if calendar wasn't checked (should not happen with code gates)
  if (!state.calendarChecked) {
    console.warn("[Agent] ⚠️ WARNING: Proceeding to payment without calendar check! This should not happen.");
  }

  // Build calendar status message if we checked
  const calendarClearNote = toolCalls.some((tc) => tc.tool === "calendar_clear")
    ? `\n\n✅ **Calendar check:** All attendees are free at event time!\n`
    : "";
  const calendarWarningNote = toolCalls.some((tc) => tc.tool === "check_calendars" && tc.summary?.includes("not connected"))
    ? `\n\n⚠️ **Google Calendar is not connected** — I couldn't check for scheduling conflicts. [Reconnect Calendar] to verify availability before booking.\n`
    : "";
  const calendarNote = calendarClearNote || calendarWarningNote;

  // ══════════════════════════════════════════════════════════════
  // Phantom wallet connected → REQUIRE wallet confirmation
  // This is code-enforced — the LLM cannot skip this
  // ══════════════════════════════════════════════════════════════
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

      state.paymentConfirmed = false; // Will be true after wallet signs

      return {
        response: `🎟️ **Ready to book ${attendees.length} ticket(s) for "${event.name}"!**${calendarNote}\n\nThis is a **free event** — no payment required. Please sign the confirmation message in your Phantom wallet to proceed.\n\n*Your wallet will be asked to sign a message (no SOL will be charged).*`,
        toolCalls,
        walletAction: { type: "sign_message", message: confirmMessage },
        pendingBooking: { event, attendees, calendarToken, attendeeEmails },
      };
    } else {
      const solAmount = calculateDevnetSol(event.price);
      const venueWallet = process.env.VENUE_WALLET_PUBLIC_KEY || "AMowwS1iaoKZMMwJxWY5jdeCKukbm64XyZEg8fwbXCPw";

      toolCalls.push({ tool: "wallet_payment", status: "completed", summary: `Requesting ${solAmount} SOL payment for $${event.price} ticket` });

      state.paymentConfirmed = false; // Will be true after wallet pays

      return {
        response: `🎟️ **Ready to book ${attendees.length} ticket(s) for "${event.name}"!**${calendarNote}\n\n**Ticket Price:** $${event.price} per ticket\n**Devnet Payment:** ${solAmount} SOL per ticket (${(solAmount * attendees.length).toFixed(6)} SOL total)\n\nPlease approve the payment in your Phantom wallet.\n\n*This is a devnet transaction — no real funds are used.*`,
        toolCalls,
        walletAction: {
          type: "transfer_sol",
          amount: solAmount * attendees.length,
          recipient: venueWallet,
          description: `${attendees.length}x ${event.name} — $${event.price * attendees.length} (${(solAmount * attendees.length).toFixed(6)} SOL devnet)`,
        },
        pendingBooking: { event, attendees, calendarToken, attendeeEmails },
      };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // No wallet → check if event is PAID before auto-executing
  // For paid events: REQUIRE wallet connection (don't silently skip payment)
  // For free events: allow server-side booking
  // ══════════════════════════════════════════════════════════════
  const isFreeEvent = event.isFree || event.price === 0;

  if (!isFreeEvent) {
    // PAID event without wallet — block and ask user to connect
    console.log(`[Agent] ⚠️ Paid event ($${event.price}) but no wallet connected — blocking booking`);
    toolCalls.push({
      tool: "wallet_required",
      status: "error",
      summary: `Wallet required for paid event ($${event.price}) — please connect Phantom wallet`,
    });
    return {
      response: `💰 **"${event.name}" costs $${event.price} per ticket** ($${event.price * attendees.length} total for ${attendees.length} ticket(s)).\n\n🔗 **Please connect your Phantom wallet** to proceed with payment. Click the **"Solana Devnet"** button in the top-right corner to connect.\n\n*Payment is on Solana devnet — no real funds are used. Once connected, just repeat your booking request and I'll process everything!*`,
      toolCalls,
    };
  }

  // FREE event — can proceed with server-side booking (no payment needed)
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

  state.bookingExecuted = true;

  // ══════════════════════════════════════════════════════════════
  // STEP 7.5: Create Google Calendar event (if calendar connected)
  // ══════════════════════════════════════════════════════════════
  let calendarEventMsg = "";
  if (calendarToken && result.success && event.date && event.time) {
    const calEventResult = await createCalendarEvent(calendarToken, {
      eventName: event.name,
      venueName: event.venue,
      eventDate: event.date,
      eventTime: event.time,
      durationMinutes: 120,
      attendeeEmails: attendeeEmails || [],
      ticketIds: result.tickets?.map((t: any) => t.assetId || t.cNftId) || [],
      transactionHashes: result.tickets?.map((t: any) => t.mintTx) || [],
      eventDayOfWeek: event.dayOfWeek,
    });

    if (calEventResult.success) {
      toolCalls.push({
        tool: "create_calendar_event",
        status: "completed",
        summary: `📅 Added "${event.name}" to Google Calendar — invites sent to all attendees!`,
      });
      calendarEventMsg = `\n\n📅 **Added to Google Calendar!** ${calEventResult.eventLink ? `[View event](${calEventResult.eventLink})` : ""}  \nAll attendees will receive calendar invites.`;
    } else {
      toolCalls.push({
        tool: "create_calendar_event",
        status: "error",
        summary: `Calendar event creation failed: ${calEventResult.error}`,
      });
    }
  }

  let response = formatBookingResult(result);
  if (calendarEventMsg) response += calendarEventMsg;
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

  // This flows through executeAndRespond which enforces calendar → payment → mint
  return await executeAndRespond(selectedMatch.event, attendees, toolCalls, userWallet, calendarToken, allEmails);
}

// --- Handle Email Send ---

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

// --- Execute Pending Booking (after Phantom wallet confirmation) ---

export async function executePendingBooking(
  event: ScrapedEvent, attendees: Attendee[], userWallet: string, paymentTxHash?: string,
  calendarToken?: string, attendeeEmails?: string[]
): Promise<{ response: string; toolCalls: ToolCallResult[]; tickets?: any[]; bookingResult?: BookingResult | null }> {
  const toolCalls: ToolCallResult[] = [];

  console.log(`\n[Agent] Executing pending booking after wallet confirmation`);
  console.log(`   Event: ${event.name}`);
  console.log(`   Wallet: ${userWallet}`);
  console.log(`   Payment Tx: ${paymentTxHash || "N/A (free)"}`);
  console.log(`   Calendar: ${calendarToken ? "connected" : "not connected"}`);

  // Mark payment as confirmed (wallet signed/paid)
  state.paymentConfirmed = true;

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

  state.bookingExecuted = true;

  // ══════════════════════════════════════════════════════════════
  // STEP 7.5: Create Google Calendar event (if calendar connected)
  // ══════════════════════════════════════════════════════════════
  let calendarEventMsg = "";
  if (calendarToken && result.success && event.date && event.time) {
    const calEventResult = await createCalendarEvent(calendarToken, {
      eventName: event.name,
      venueName: event.venue,
      eventDate: event.date,
      eventTime: event.time,
      durationMinutes: 120,
      attendeeEmails: attendeeEmails || [],
      ticketIds: result.tickets?.map((t: any) => t.assetId || t.cNftId) || [],
      transactionHashes: result.tickets?.map((t: any) => t.mintTx) || [],
      eventDayOfWeek: event.dayOfWeek,
    });

    if (calEventResult.success) {
      toolCalls.push({
        tool: "create_calendar_event",
        status: "completed",
        summary: `📅 Added "${event.name}" to Google Calendar — invites sent to all attendees!`,
      });
      calendarEventMsg = `\n\n📅 **Added to Google Calendar!** ${calEventResult.eventLink ? `[View event](${calEventResult.eventLink})` : ""}  \nAll attendees will receive calendar invites.`;
    } else {
      toolCalls.push({
        tool: "create_calendar_event",
        status: "error",
        summary: `Calendar event creation failed: ${calEventResult.error}`,
      });
    }
  }

  let response = formatBookingResult(result);
  if (calendarEventMsg) response += calendarEventMsg;
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
  state.calendarChecked = false;
  state.paymentConfirmed = false;
  state.bookingExecuted = false;
}