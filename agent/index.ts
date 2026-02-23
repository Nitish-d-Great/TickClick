// =============================================
// TickClick — Conversational AI Ticket Agent
// Uses LLM to decide actions dynamically
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

// --- Classify user intent (what does the user want?) ---

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
- "book_ticket" — user explicitly wants to book/purchase/reserve tickets for specific people with details like names, budget, dates
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

  // Validate it's a known action
  const validActions: UserAction[] = [
    "greeting",
    "search_events",
    "book_ticket",
    "check_calendar",
    "general_question",
    "confirm_booking",
    "cancel",
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
    messages.push({
      role: "system",
      content: systemContext,
    });
  }

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 1000,
  });

  return response.choices[0]?.message?.content || "I'm here to help you find and book event tickets! What are you looking for?";
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
    // --- Step 1: Classify what the user wants ---
    const action = await classifyAction(userMessage, state.awaitingConfirmation);
    console.log(`[Agent] Classified action: ${action}`);

    switch (action) {
      // ========================================
      // GREETING — Just chat back
      // ========================================
      case "greeting": {
        const response = await generateResponse(userMessage, conversationHistory);
        return { response, toolCalls };
      }

      // ========================================
      // GENERAL QUESTION — Answer conversationally
      // ========================================
      case "general_question": {
        const response = await generateResponse(
          userMessage,
          conversationHistory,
          "Answer the user's question helpfully. You are TickClick, an AI ticketing agent that can discover events at KYD-powered venues (Le Poisson Rouge, DJ Mike Nasty), check Google Calendar availability, and book on-chain cNFT tickets on Solana. Explain what you can do if asked."
        );
        return { response, toolCalls };
      }

      // ========================================
      // CANCEL / RESET
      // ========================================
      case "cancel": {
        resetAgentState();
        return {
          response: "No problem! I've cleared everything. What would you like to do next?",
          toolCalls: [],
        };
      }

      // ========================================
      // SEARCH EVENTS — Discover what's available
      // ========================================
      case "search_events": {
        return await handleEventSearch(userMessage, conversationHistory, toolCalls);
      }

      // ========================================
      // BOOK TICKET — Full booking flow
      // ========================================
      case "book_ticket": {
        return await handleBookingRequest(userMessage, conversationHistory, toolCalls);
      }

      // ========================================
      // CONFIRM BOOKING — User picked an event
      // ========================================
      case "confirm_booking": {
        if (state.awaitingConfirmation && state.lastPresentedEvents.length > 0) {
          return await handleBookingConfirmation(userMessage, toolCalls);
        }
        // No events to confirm — treat as search
        return await handleEventSearch(userMessage, conversationHistory, toolCalls);
      }

      // ========================================
      // CHECK CALENDAR
      // ========================================
      case "check_calendar": {
        const response = await generateResponse(
          userMessage,
          conversationHistory,
          "The user wants to check calendar availability. Ask them: 1) Who are the attendees (names)? 2) What dates/days are they considering? Once you have this info, you can check their Google Calendars for free slots."
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
    return {
      response: "Sorry, I hit a snag processing that. Could you try rephrasing?",
      toolCalls,
    };
  }
}

// --- Handle Event Search ---

async function handleEventSearch(
  userMessage: string,
  conversationHistory: ChatMessage[],
  toolCalls: ToolCallResult[]
): Promise<{
  response: string;
  toolCalls: ToolCallResult[];
  events?: EventMatch[];
}> {
  // Scrape events
  toolCalls.push({
    tool: "discover_events",
    status: "running",
    summary: "Scanning KYD-powered venues for events...",
  });

  let events: ScrapedEvent[];
  try {
    events = await discoverEvents();
  } catch {
    events = getStaticEventData();
  }
  state.events = events;

  toolCalls[toolCalls.length - 1] = {
    tool: "discover_events",
    status: "completed",
    summary: `Found ${events.length} events across KYD venues`,
    data: { count: events.length },
  };

  // Light intent extraction to filter
  const intent = await extractIntent(userMessage);

  // Match events
  toolCalls.push({
    tool: "match_events",
    status: "running",
    summary: "Finding the best matches...",
  });

  const matches = matchEvents(events, intent, undefined);
  state.matches = matches;
  state.lastPresentedEvents = matches;

  toolCalls[toolCalls.length - 1] = {
    tool: "match_events",
    status: "completed",
    summary: `${matches.length} event(s) match your criteria`,
    data: { matchCount: matches.length },
  };

  // Generate conversational response with results
  const matchSummary = formatMatchResults(matches);
  const response = await generateResponse(
    userMessage,
    conversationHistory,
    `Here are the events you found. Present them clearly and conversationally:\n\n${matchSummary}\n\nAfter listing the events, ask if they'd like to book any of them. Number each event so they can say "book #1" etc. If no events matched, let them know and suggest broadening their search.`
  );

  if (matches.length > 0) {
    state.awaitingConfirmation = true;
  }

  return {
    response,
    toolCalls,
    events: matches,
  };
}

// --- Handle Full Booking Request ---

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
  toolCalls.push({
    tool: "parse_intent",
    status: "running",
    summary: "Understanding your booking request...",
  });

  const intent = await extractIntent(userMessage);
  state.intent = intent;

  toolCalls[toolCalls.length - 1] = {
    tool: "parse_intent",
    status: "completed",
    summary: `Looking for ${intent.attendees.length} ticket(s)${
      intent.budget ? `, under $${intent.budget}` : ""
    }${intent.preferredDays.length > 0 ? `, ${intent.preferredDays.join("/")}` : ""}${
      intent.genres.length > 0 ? `, genres: ${intent.genres.join(", ")}` : ""
    }`,
    data: intent,
  };

  // Step 2: Discover events
  toolCalls.push({
    tool: "discover_events",
    status: "running",
    summary: "Scanning KYD-powered venues...",
  });

  let events: ScrapedEvent[];
  try {
    events = await discoverEvents();
  } catch {
    events = getStaticEventData();
  }
  state.events = events;

  toolCalls[toolCalls.length - 1] = {
    tool: "discover_events",
    status: "completed",
    summary: `Found ${events.length} events across KYD venues`,
    data: { count: events.length },
  };

  // Step 3: Check calendars (if requested and attendees provided)
  let freeSlots;
  if (intent.checkCalendar && intent.attendees.length > 0) {
    toolCalls.push({
      tool: "check_calendars",
      status: "running",
      summary: `Checking availability for ${intent.attendees.map((a) => a.name).join(" & ")}...`,
    });

    const attendeeNames = intent.attendees.map((a) => a.name);
    const availability = getMockAvailability(attendeeNames);
    freeSlots = findOverlappingFreeSlots(availability, intent.preferredDays);

    toolCalls[toolCalls.length - 1] = {
      tool: "check_calendars",
      status: "completed",
      summary: `Found ${freeSlots.length} overlapping free slots`,
      data: { freeSlotCount: freeSlots.length },
    };
  }

  // Step 4: Match events
  toolCalls.push({
    tool: "match_events",
    status: "running",
    summary: "Finding the best matches...",
  });

  const matches = matchEvents(events, intent, freeSlots);
  state.matches = matches;
  state.lastPresentedEvents = matches;

  toolCalls[toolCalls.length - 1] = {
    tool: "match_events",
    status: "completed",
    summary: `${matches.length} event(s) match your criteria`,
    data: { matchCount: matches.length },
  };

  // Step 5: Present results
  const matchSummary = formatMatchResults(matches);

  const attendeeNames = intent.attendees.map((a) => a.name).join(" & ");
  const contextInfo = [
    `Attendees: ${attendeeNames || "not specified"}`,
    intent.budget ? `Budget: under $${intent.budget}` : null,
    intent.preferredDays.length > 0 ? `Preferred days: ${intent.preferredDays.join(", ")}` : null,
    intent.genres.length > 0 ? `Genres: ${intent.genres.join(", ")}` : null,
    intent.checkCalendar ? `Calendar checked: yes` : null,
    freeSlots ? `Free slots found: ${freeSlots.length}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await generateResponse(
    userMessage,
    conversationHistory,
    `You extracted this booking intent:\n${contextInfo}\n\nHere are the matching events:\n${matchSummary}\n\nPresent the results clearly. Number each event (#1, #2, etc). Include all details: name, date, time, venue, price. Mention the attendees by name. Ask which event they'd like to book. If no matches, explain why and suggest alternatives.`
  );

  if (matches.length > 0) {
    state.awaitingConfirmation = true;
  }

  return {
    response,
    toolCalls,
    events: matches,
  };
}

// --- Handle Booking Confirmation ---

async function handleBookingConfirmation(
  userMessage: string,
  toolCalls: ToolCallResult[]
): Promise<{
  response: string;
  toolCalls: ToolCallResult[];
  tickets?: any[];
}> {
  const message = userMessage.toLowerCase();

  // Determine which event the user selected
  let selectedIndex = -1;

  if (
    message.includes("#1") ||
    message.includes("first") ||
    message === "1" ||
    message.includes("yes") ||
    message.includes("book it") ||
    message.includes("go ahead") ||
    message.includes("confirm")
  ) {
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
      response: `I have ${state.lastPresentedEvents.length} event(s) listed. Which one would you like to book? You can say "book #1", "book #2", etc.`,
      toolCalls: [],
    };
  }

  const selectedMatch = state.lastPresentedEvents[selectedIndex];
  const event = selectedMatch.event;
  const attendees = state.intent?.attendees || [{ name: "User" }];

  // Execute booking
  toolCalls.push({
    tool: "execute_booking",
    status: "running",
    summary: `Booking "${event.name}" for ${attendees.map((a) => a.name).join(" & ")}...`,
  });

  let result;
  const isLiveMode =
    process.env.FAN_WALLET_SECRET_KEY && process.env.MERKLE_TREE_ADDRESS;

  if (isLiveMode) {
    result = await executeBooking({
      event,
      attendees,
      fanWalletAddress: "",
    });
  } else {
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

  // Reset confirmation state (but keep events cached)
  state.awaitingConfirmation = false;

  return {
    response,
    toolCalls,
    tickets: result.tickets,
  };
}

// --- Reset Agent State ---

export function resetAgentState() {
  state.events = [];
  state.matches = [];
  state.intent = null;
  state.awaitingConfirmation = false;
  state.lastPresentedEvents = [];
}