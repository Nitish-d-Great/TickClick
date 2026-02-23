// =============================================
// TixAgent — Core Type Definitions
// =============================================

// --- Event Types ---

export interface ScrapedEvent {
  id: string;
  name: string;
  artist: string;
  venue: string;
  venueUrl: string;
  date: string; // ISO date string
  time: string;
  dayOfWeek: string; // "Saturday", "Sunday", etc.
  price: number; // in USD, 0 for free events
  isFree: boolean;
  genre?: string;
  description?: string;
  imageUrl?: string;
  ticketUrl?: string;
}

// --- Calendar Types ---

export interface CalendarSlot {
  start: string; // ISO datetime
  end: string;
  isFree: boolean;
}

export interface AttendeeAvailability {
  name: string;
  email: string;
  freeSlots: CalendarSlot[];
}

export interface OverlappingSlot {
  date: string;
  dayOfWeek: string;
  start: string;
  end: string;
  attendees: string[];
}

// --- Agent Types ---

export interface UserIntent {
  attendees: Attendee[];
  budget: number | null;
  preferredDays: string[]; // ["Saturday", "Sunday"]
  genres: string[];
  checkCalendar: boolean;
  venuePreference?: string;
  additionalNotes?: string;
}

export interface Attendee {
  name: string;
  email?: string;
  walletAddress?: string;
}

export interface EventMatch {
  event: ScrapedEvent;
  score: number;
  reasons: string[];
  calendarMatch?: boolean;
  matchingSlot?: OverlappingSlot;
}

// --- Booking Types ---

export interface BookingRequest {
  event: ScrapedEvent;
  attendees: Attendee[];
  fanWalletAddress: string;
}

export interface BookingResult {
  success: boolean;
  event: ScrapedEvent;
  tickets: TicketInfo[];
  paymentTxHash?: string;
  totalPaid: number;
  error?: string;
}

export interface TicketInfo {
  attendeeName: string;
  cnftAssetId: string;
  mintTxHash: string;
  eventName: string;
  eventDate: string;
  venue: string;
  pricePaid: number;
  status: TicketStatus;
  explorerUrl: string;
}

export enum TicketStatus {
  Active = "Active",
  Redeemed = "Redeemed",
  Cancelled = "Cancelled",
}

// --- Chat Types ---

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCallResult[];
  tickets?: TicketInfo[];
  events?: EventMatch[];
}

export interface ToolCallResult {
  tool: string;
  status: "running" | "completed" | "error";
  summary: string;
  data?: any;
}

// --- Solana Types ---

export interface WalletInfo {
  publicKey: string;
  balance: number; // in SOL
}
