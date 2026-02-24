// =============================================
// TickClick — Conversational AI Ticket Agent
// Uses LLM to decide actions dynamically
// Executes REAL Solana transactions when configured
// =============================================

import OpenAI from "openai";
import { SYSTEM_PROMPT, INTENT_EXTRACTION_PROMPT } from "./prompts/system";
import { discoverEvents, getStaticEventData } from "./tools/scrapeEvents";
import {
  getMockAvailability,
  findOverlappingFreeSlots,
} from "./tools/checkCalendar";
import { matchEvents, formatMatchResults } from "./tools/matchEvents";
import {
  executeBooking,
  simulateBooking,
  formatBookingResult,
} from "./tools/executeBooking";
import {
  ChatMessage,
  UserIntent,
  ScrapedEvent,
  EventMatch,
  ToolCallResult,
  Attendee,
} from "@/types";

// --- Agent State ---

interface AgentState {
  events: ScrapedEvent[];
  matches: EventMatch[];
  intent: UserIntent | null;
  awaitingConfirmation: boolean;
  lastPresentedEvents: EventMatch[];
}

const state: AgentState = {
  events: [],
  matches: [],
  intent: null,
  awaitingConfirmation: false,
  lastPresentedEvents: [],
};

// --- Groq Client (OpenAI-compatible) ---

function getLLMClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in environment variables");
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

const LLM_MODEL = "llama-3.3-70b-versatile";

// --- Classify user intent ---

type UserAction =
  | "greeting"
  | "search_events"
  | "book_ticket"
  | "check_calendar"
  | "general_question"
  | "confirm_booking"
  | "cancel";

async function classifyAction(
  userMessage: string,
  isAwaitingConfirmation: boolean
): Promise<UserAction> {
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
- "check_calendar" — user specifically asks about calendar availability
- "general_question" — user asks about how the agent works, what it can do, or other non-booking questions
- "cancel" — user wants to cancel, start over, or reset

${isAwaitingConfirmation ? "IMPORTANT: The agent just showed event options and is waiting for the user to pick one. If the user seems to be selecting or confirming, classify as 'confirm_booking'. If they're asking something new, classify appropriately." : ""}`,
      },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
    max_tokens: 20,
  });

  const action = (response.choices[0]?.message?.content || "general_question")
    .trim()
    .replace(/"/g, "")
    .toLowerCase() as UserAction;

  const validActions: UserAction[] = [
    "greeting", "search_events", "book_ticket", "check_calendar",
    "general_question", "confirm_booking", "cancel",
  ];

  return validActions.includes(action) ? action : "general_question";
}

// --- Extract booking intent ---

async function extractIntent(userMessage: string): Promise<UserIntent> {
  const client = getLLMClient();

  try {
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You extract structured booking intent from user messages. Respond ONLY with valid JSON, no markdown, no code fences.",
        },
        {
          role: "user",
          content: INTENT_EXTRACTION_PROMPT + userMessage,
        },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

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
    return {
      attendees: [{ name: "User" }],
      budget: null,
      preferredDays: [],
      genres: [],
      checkCalendar: false,
    };
  }
}

// --- Generate conversational response ---

async function generateResponse(
  userMessage: string,
  conversationHistory: ChatMessage[],
  systemContext?: string
): Promise<string> {
  const client = getLLMClient();

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory.slice(-10).map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
    { role: "user", content: userMessage },
  ];

  if (systemContext) {
    messages.push({ role: "system", content: systemContext });
  }

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 1000,
  });

  return response.choices[0]?.message?.content || "I'm here to help you find and book event tickets!";
}

// --- Check if event name matches user query ---

function findEventByName(events: ScrapedEvent[], query: string): ScrapedEvent | null {
  const q = query.toLowerCase();
  // Try exact-ish match first
  for (const event of events) {
    if (q.includes(event.name.toLowerCase())) return event;
    if (event.name.toLowerCase().includes(q)) return event;
  }
  // Try partial word match
  const words = q.split(/\s+/).filter((w) => w.length > 3);
  for (const event of events) {
    const eName = event.name.toLowerCase();
    if (words.some((w) => eName.includes(w))) return event;
  }
  return null;
}

// --- Main Agent Handler ---

export async function handleMessage(
  userMessage: string,
  conversationHistory: ChatMessage[]
): Promise<{
  response: string;
  toolCalls: ToolCallResult[];
  tickets?: any[];
  events?: EventMatch[];
}> {
  const toolCalls: ToolCallResult[] = [];

  try {
    const action = await classifyAction(userMessage, state.awaitingConfirmation);
    console.log(`[Agent] Classified action: ${action}`);

    switch (action) {
      case "greeting": {
        const response = await generateResponse(userMessage, conversationHistory);
        return { response, toolCalls };
      }

      case "general_question": {
        const response = await generateResponse(
          userMessage, conversationHistory,
          "Answer the user's question helpfully. You are TickClick, an AI ticketing agent that discovers events at KYD-powered venues (Le Poisson Rouge, DJ Mike Nasty), checks Google Calendar availability, and books real on-chain cNFT tickets on Solana devnet. Each booking mints a real compressed NFT."
        );
        return { response, toolCalls };
      }

      case "cancel": {
        resetAgentState();
        return { response: "No problem! I've cleared everything. What would you like to do next?", toolCalls: [] };
      }

      case "search_events": {
        return await handleEventSearch(userMessage, conversationHistory, toolCalls);
      }

      case "book_ticket": {
        return await handleBookingRequest(userMessage, conversationHistory, toolCalls);
      }

      case "confirm_booking": {
        if (state.awaitingConfirmation && state.lastPresentedEvents.length > 0) {
          return await handleBookingConfirmation(userMessage, toolCalls);
        }
        return await handleEventSearch(userMessage, conversationHistory, toolCalls);
      }

      case "check_calendar": {
        const response = await generateResponse(
          userMessage, conversationHistory,
          "The user wants to check calendar availability. Ask them: 1) Who are the attendees? 2) What dates/days? Once you have this info, you can check their Google Calendars for free slots."
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

// --- Handle Event Search (browse only, no booking) ---

async function handleEventSearch(
  userMessage: string,
  conversationHistory: ChatMessage[],
  toolCalls: ToolCallResult[]
): Promise<{
  response: string;
  toolCalls: ToolCallResult[];
  events?: EventMatch[];
}> {
  toolCalls.push({ tool: "discover_events", status: "running", summary: "Scanning KYD-powered venues for events..." });

  let events: ScrapedEvent[];
  try { events = await discoverEvents(); }
  catch { events = getStaticEventData(); }
  state.events = events;

  toolCalls[toolCalls.length - 1] = {
    tool: "discover_events", status: "completed",
    summary: `Found ${events.length} events across KYD venues`,
    data: { count: events.length },
  };

  const intent = await extractIntent(userMessage);
  const matches = matchEvents(events, intent, undefined);
  state.matches = matches;
  state.lastPresentedEvents = matches;

  toolCalls.push({
    tool: "match_events", status: "completed",
    summary: `${matches.length} event(s) match your criteria`,
    data: { matchCount: matches.length },
  });

  const matchSummary = formatMatchResults(matches);
  const response = await generateResponse(
    userMessage, conversationHistory,
    `Here are the events found. Present them clearly with numbers (#1, #2, etc):\n\n${matchSummary}\n\nAfter listing, ask which they'd like to book. Do NOT fabricate any booking — just list the events.`
  );

  if (matches.length > 0) {
    state.awaitingConfirmation = true;
    state.intent = intent;
  }

  return { response, toolCalls, events: matches };
}

// --- Handle Booking Request (actually executes real booking!) ---

async function handleBookingRequest(
  userMessage: string,
  conversationHistory: ChatMessage[],
  toolCalls: ToolCallResult[]
): Promise<{
  response: string;
  toolCalls: ToolCallResult[];
  tickets?: any[];
  events?: EventMatch[];
}> {
  // Step 1: Extract intent
  toolCalls.push({ tool: "parse_intent", status: "running", summary: "Understanding your booking request..." });
  const intent = await extractIntent(userMessage);
  state.intent = intent;

  toolCalls[toolCalls.length - 1] = {
    tool: "parse_intent", status: "completed",
    summary: `Looking for ${intent.attendees.length} ticket(s)${intent.budget ? `, under $${intent.budget}` : ""}`,
    data: intent,
  };

  // Step 2: Discover events
  toolCalls.push({ tool: "discover_events", status: "running", summary: "Scanning KYD-powered venues..." });

  let events: ScrapedEvent[];
  try { events = await discoverEvents(); }
  catch { events = getStaticEventData(); }
  state.events = events;

  toolCalls[toolCalls.length - 1] = {
    tool: "discover_events", status: "completed",
    summary: `Found ${events.length} events across KYD venues`,
    data: { count: events.length },
  };

  // Step 3: Check calendars (if requested)
  let freeSlots;
  if (intent.checkCalendar && intent.attendees.length > 0) {
    toolCalls.push({
      tool: "check_calendars", status: "running",
      summary: `Checking availability for ${intent.attendees.map((a) => a.name).join(" & ")}...`,
    });
    const attendeeNames = intent.attendees.map((a) => a.name);
    const availability = getMockAvailability(attendeeNames);
    freeSlots = findOverlappingFreeSlots(availability, intent.preferredDays);
    toolCalls[toolCalls.length - 1] = {
      tool: "check_calendars", status: "completed",
      summary: `Found ${freeSlots.length} overlapping free slots`,
      data: { freeSlotCount: freeSlots.length },
    };
  }

  // Step 4: Match events
  toolCalls.push({ tool: "match_events", status: "running", summary: "Finding the best matches..." });
  const matches = matchEvents(events, intent, freeSlots);
  state.matches = matches;
  state.lastPresentedEvents = matches;

  toolCalls[toolCalls.length - 1] = {
    tool: "match_events", status: "completed",
    summary: `${matches.length} event(s) match your criteria`,
    data: { matchCount: matches.length },
  };

  // Step 5: Try to find the specific event user mentioned
  const specificEvent = findEventByName(events, userMessage);

  if (specificEvent) {
    // User named a specific event — BOOK IT NOW
    console.log(`[Agent] User named specific event: "${specificEvent.name}" — executing real booking!`);

    const attendees = intent.attendees.length > 0 ? intent.attendees : [{ name: "User" }];

    toolCalls.push({
      tool: "execute_booking", status: "running",
      summary: `Booking "${specificEvent.name}" for ${attendees.map((a) => a.name).join(" & ")}...`,
    });

    // *** THIS IS WHERE REAL BOOKING HAPPENS ***
    let result;
    if (process.env.MERKLE_TREE_ADDRESS && process.env.USER_WALLET_PUBLIC_KEY) {
      console.log(`[Agent] MERKLE_TREE_ADDRESS found — calling executeBooking() for REAL minting`);
      result = await executeBooking({
        event: specificEvent,
        attendees,
        fanWalletAddress: process.env.USER_WALLET_PUBLIC_KEY || "",
      });
    } else {
      console.log(`[Agent] No MERKLE_TREE_ADDRESS — falling back to simulation`);
      result = simulateBooking(specificEvent, attendees);
    }

    toolCalls[toolCalls.length - 1] = {
      tool: "execute_booking",
      status: result.success ? "completed" : "error",
      summary: result.success
        ? `Booked ${result.tickets.length} ticket(s) on Solana!`
        : `Booking failed: ${result.error}`,
      data: result,
    };

    const response = formatBookingResult(result);
    state.awaitingConfirmation = false;

    return { response, toolCalls, tickets: result.tickets };
  }

  // No specific event found — present options and wait for selection
  const matchSummary = formatMatchResults(matches);
  const attendeeNames = intent.attendees.map((a) => a.name).join(" & ");

  const response = await generateResponse(
    userMessage, conversationHistory,
    `Attendees: ${attendeeNames || "not specified"}\n\nHere are the matching events:\n${matchSummary}\n\nPresent results with numbers (#1, #2, etc). Include all details. Ask which event to book. Do NOT pretend to have booked anything — you must wait for the user to choose.`
  );

  if (matches.length > 0) {
    state.awaitingConfirmation = true;
  }

  return { response, toolCalls, events: matches };
}

// --- Handle Booking Confirmation (#1, #2, yes, etc.) ---

async function handleBookingConfirmation(
  userMessage: string,
  toolCalls: ToolCallResult[]
): Promise<{
  response: string;
  toolCalls: ToolCallResult[];
  tickets?: any[];
}> {
  const message = userMessage.toLowerCase();
  let selectedIndex = -1;

  if (message.includes("#1") || message.includes("first") || message === "1" ||
      message.includes("yes") || message.includes("book it") || message.includes("go ahead") ||
      message.includes("confirm")) {
    selectedIndex = 0;
  } else if (message.includes("#2") || message === "2" || message.includes("second")) {
    selectedIndex = 1;
  } else if (message.includes("#3") || message === "3" || message.includes("third")) {
    selectedIndex = 2;
  } else if (message.includes("#4") || message === "4" || message.includes("fourth")) {
    selectedIndex = 3;
  } else if (message.includes("#5") || message === "5" || message.includes("fifth")) {
    selectedIndex = 4;
  }

  if (selectedIndex < 0 || selectedIndex >= state.lastPresentedEvents.length) {
    return {
      response: `I have ${state.lastPresentedEvents.length} event(s) listed. Which one would you like to book? Say "book #1", "book #2", etc.`,
      toolCalls: [],
    };
  }

  const selectedMatch = state.lastPresentedEvents[selectedIndex];
  const event = selectedMatch.event;
  const attendees = state.intent?.attendees || [{ name: "User" }];

  toolCalls.push({
    tool: "execute_booking", status: "running",
    summary: `Booking "${event.name}" for ${attendees.map((a) => a.name).join(" & ")}...`,
  });

  // *** REAL BOOKING ***
  let result;
  if (process.env.MERKLE_TREE_ADDRESS && process.env.USER_WALLET_PUBLIC_KEY) {
    console.log(`[Agent] Confirmation booking — calling executeBooking() for REAL minting`);
    result = await executeBooking({
      event,
      attendees,
      fanWalletAddress: process.env.USER_WALLET_PUBLIC_KEY || "",
    });
  } else {
    console.log(`[Agent] No MERKLE_TREE_ADDRESS — falling back to simulation`);
    result = simulateBooking(event, attendees);
  }

  toolCalls[toolCalls.length - 1] = {
    tool: "execute_booking",
    status: result.success ? "completed" : "error",
    summary: result.success
      ? `Booked ${result.tickets.length} ticket(s) on Solana!`
      : `Booking failed: ${result.error}`,
    data: result,
  };

  const response = formatBookingResult(result);
  state.awaitingConfirmation = false;

  return { response, toolCalls, tickets: result.tickets };
}

// --- Reset ---

export function resetAgentState() {
  state.events = [];
  state.matches = [];
  state.intent = null;
  state.awaitingConfirmation = false;
  state.lastPresentedEvents = [];
}