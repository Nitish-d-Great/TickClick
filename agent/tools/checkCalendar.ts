// =============================================
// TixAgent — Calendar Availability Tool
// Checks Google Calendar FreeBusy for attendees
// Creates calendar events after successful booking
// Falls back to mock data if no token available
// =============================================

import { Attendee, OverlappingSlot } from "@/types";

export interface CalendarCheckResult {
  success: boolean;
  attendees: {
    email: string;
    name: string;
    busy: { start: string; end: string }[];
    isFree: boolean;
    error?: string;
  }[];
  allFree: boolean;
  error?: string;
}

export interface CalendarEventResult {
  success: boolean;
  eventId?: string;
  eventLink?: string;
  error?: string;
}

/**
 * Check calendar availability for a specific event time using Google Calendar FreeBusy API.
 */
export async function checkCalendarForEvent(
  calendarToken: string,
  attendeeEmails: string[],
  eventDate: string,
  eventTime: string,
  eventDayOfWeek?: string
): Promise<CalendarCheckResult> {
  if (!calendarToken || attendeeEmails.length === 0) {
    return { success: false, attendees: [], allFree: true, error: "No calendar token or emails" };
  }

  const { timeMin, timeMax } = parseEventTimeRange(eventDate, eventTime);

  if (!timeMin || !timeMax) {
    console.log(`[Calendar] Could not parse event time: ${eventDate} at ${eventTime}`);
    return { success: false, attendees: [], allFree: true, error: "Could not parse event time" };
  }

  console.log(`\n[Calendar] Checking availability for event`);
  console.log(`   Date: ${eventDate} at ${eventTime}`);
  console.log(`   Range: ${timeMin} — ${timeMax}`);
  console.log(`   Emails: ${attendeeEmails.join(", ")}`);

  try {
    const freeBusyResponse = await fetch(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${calendarToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: attendeeEmails.map((email) => ({ id: email })),
        }),
      }
    );

    if (!freeBusyResponse.ok) {
      const errorData = await freeBusyResponse.json();
      console.error("[Calendar] FreeBusy API error:", errorData);
      return {
        success: false,
        attendees: [],
        allFree: true,
        error: freeBusyResponse.status === 401
          ? "Calendar token expired"
          : `API error: ${errorData.error?.message || "Unknown"}`,
      };
    }

    const data = await freeBusyResponse.json();
    const calendars = data.calendars || {};

    const attendees = attendeeEmails.map((email) => {
      const calData = calendars[email];

      if (!calData) {
        return {
          email,
          name: email.split("@")[0],
          busy: [],
          isFree: true,
          error: "Calendar not accessible — may not be shared",
        };
      }

      if (calData.errors && calData.errors.length > 0) {
        return {
          email,
          name: email.split("@")[0],
          busy: [],
          isFree: true,
          error: `Calendar error: ${calData.errors[0]?.reason || "unknown"}`,
        };
      }

      const busyBlocks = (calData.busy || []).map((b: any) => ({
        start: b.start,
        end: b.end,
      }));

      return {
        email,
        name: email.split("@")[0],
        busy: busyBlocks,
        isFree: busyBlocks.length === 0,
      };
    });

    const allFree = attendees.every((a) => a.isFree);

    attendees.forEach((a) => {
      if (a.isFree) {
        console.log(`   ✅ ${a.email}: FREE`);
      } else {
        console.log(`   🔴 ${a.email}: BUSY (${a.busy.length} conflict(s))`);
      }
    });

    return { success: true, attendees, allFree };
  } catch (err: any) {
    console.error("[Calendar] FreeBusy error:", err.message);
    return { success: false, attendees: [], allFree: true, error: err.message };
  }
}

// =============================================
// CREATE CALENDAR EVENT (after successful booking)
// =============================================

interface CreateCalendarEventOptions {
  eventName: string;
  venueName: string;
  eventDate: string;        // e.g., "Feb 28"
  eventTime: string;        // e.g., "11:00 PM"
  durationMinutes?: number; // default: 120
  attendeeEmails?: string[];
  ticketIds?: string[];
  transactionHashes?: string[];
  eventDayOfWeek?: string;
}

/**
 * Create a Google Calendar event after a successful ticket booking.
 * Adds the event to the authenticated user's calendar and sends
 * calendar invites to all attendees.
 */
export async function createCalendarEvent(
  calendarToken: string,
  options: CreateCalendarEventOptions
): Promise<CalendarEventResult> {
  if (!calendarToken) {
    return { success: false, error: "No calendar token" };
  }

  const {
    eventName,
    venueName,
    eventDate,
    eventTime,
    durationMinutes = 120,
    attendeeEmails = [],
    ticketIds = [],
    transactionHashes = [],
  } = options;

  // Parse the event start time
  const startDate = parseEventDateTime(eventDate, eventTime);
  if (!startDate) {
    console.log(`[Calendar] Could not parse date/time for event creation: ${eventDate} ${eventTime}`);
    return { success: false, error: "Could not parse event date/time" };
  }

  // Calculate end time
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  // Build event description with ticket details
  let description = `🎟️ Booked via TixAgent — AI Ticket Concierge\n\n`;
  description += `Venue: ${venueName}\n`;
  description += `Tickets: ${ticketIds.length || "N/A"}\n\n`;

  if (ticketIds.length > 0) {
    description += `── On-Chain Ticket Details ──\n\n`;
    ticketIds.forEach((id, i) => {
      description += `Ticket ${i + 1}: ${id}\n`;
      if (transactionHashes[i]) {
        description += `Verify: https://explorer.solana.com/tx/${transactionHashes[i]}?cluster=devnet\n`;
      }
      description += `\n`;
    });
  }

  description += `Powered by Solana devnet • cNFT tickets via Metaplex Bubblegum`;

  // Build the Google Calendar event
  const calendarEvent = {
    summary: `🎟️ ${eventName}`,
    location: venueName,
    description,
    start: {
      dateTime: startDate.toISOString(),
      timeZone: "America/New_York",
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: "America/New_York",
    },
    attendees: attendeeEmails.map((email) => ({ email })),
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 60 },     // 1 hour before
        { method: "popup", minutes: 1440 },    // 1 day before
      ],
    },
  };

  console.log(`\n[Calendar] Creating event: "${eventName}"`);
  console.log(`   Start: ${startDate.toISOString()}`);
  console.log(`   End: ${endDate.toISOString()}`);
  console.log(`   Duration: ${durationMinutes} min`);
  console.log(`   Attendees: ${attendeeEmails.join(", ") || "none"}`);

  try {
    // sendUpdates=all → Google sends calendar invites to all attendees
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${calendarToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(calendarEvent),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[Calendar] Event creation failed:", errorData);

      if (response.status === 401) {
        return { success: false, error: "Calendar token expired — reconnect Google Calendar" };
      }
      if (response.status === 403) {
        return { success: false, error: "Insufficient permissions — reconnect Google Calendar to grant event creation access" };
      }

      return {
        success: false,
        error: `Calendar API error: ${errorData.error?.message || "Unknown"}`,
      };
    }

    const data = await response.json();

    console.log(`   ✅ Event created: ${data.id}`);
    console.log(`   🔗 Link: ${data.htmlLink}`);
    if (attendeeEmails.length > 0) {
      console.log(`   📧 Calendar invites sent to ${attendeeEmails.length} attendee(s)`);
    }

    return {
      success: true,
      eventId: data.id,
      eventLink: data.htmlLink,
    };
  } catch (err: any) {
    console.error("[Calendar] Event creation error:", err.message);
    return { success: false, error: err.message };
  }
}

// =============================================
// DATE/TIME PARSING UTILITIES
// =============================================

/**
 * Parse event date/time strings into a Date object.
 * Input: "Feb 28", "11:00 PM" → Date(2026, 1, 28, 23, 0)
 */
function parseEventDateTime(dateStr: string, timeStr: string): Date | null {
  try {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };

    const dateMatch = dateStr.match(
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i
    );
    if (!dateMatch) return null;

    const month = months[dateMatch[1].toLowerCase()];
    const day = parseInt(dateMatch[2]);
    const year = new Date().getFullYear();

    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const ampm = timeMatch[3].toUpperCase();

    if (ampm === "PM" && hours !== 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    return new Date(year, month, day, hours, minutes);
  } catch {
    return null;
  }
}

/**
 * Parse event date/time strings into ISO time range for FreeBusy.
 * Checks 30 min before to 3 hours after event start.
 */
function parseEventTimeRange(
  dateStr: string,
  timeStr: string
): { timeMin: string | null; timeMax: string | null } {
  try {
    const eventStart = parseEventDateTime(dateStr, timeStr);
    if (!eventStart) return { timeMin: null, timeMax: null };

    const checkStart = new Date(eventStart.getTime() - 30 * 60 * 1000);
    const checkEnd = new Date(eventStart.getTime() + 3 * 60 * 60 * 1000);

    return {
      timeMin: checkStart.toISOString(),
      timeMax: checkEnd.toISOString(),
    };
  } catch {
    return { timeMin: null, timeMax: null };
  }
}

/**
 * Format calendar check results for the agent's response.
 */
export function formatCalendarResults(result: CalendarCheckResult): string {
  if (!result.success) {
    return `⚠️ Could not check calendars: ${result.error}`;
  }

  let msg = "";

  if (result.allFree) {
    msg += `✅ **All attendees are free!**\n\n`;
    result.attendees.forEach((a) => {
      msg += `- ${a.email}: FREE ✅`;
      if (a.error) msg += ` _(${a.error})_`;
      msg += `\n`;
    });
  } else {
    msg += `⚠️ **Calendar Conflict Detected!**\n\n`;
    result.attendees.forEach((a) => {
      if (a.isFree) {
        msg += `- ${a.email}: FREE ✅\n`;
      } else {
        msg += `- ${a.email}: BUSY 🔴\n`;
        a.busy.forEach((b) => {
          const start = new Date(b.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          const end = new Date(b.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          msg += `  → Busy from ${start} to ${end}\n`;
        });
      }
    });
  }

  return msg;
}

// =============================================
// MOCK DATA (used when Google Calendar is not connected)
// =============================================

export interface CalendarAvailability {
  name: string;
  freeSlots: {
    date: string;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
  }[];
}

export function getMockAvailability(
  attendeeNames: string[]
): CalendarAvailability[] {
  const today = new Date();
  const availabilities: CalendarAvailability[] = [];

  for (const name of attendeeNames) {
    const freeSlots = [];

    for (let i = 0; i < 14; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long" });
      const dateStr = date.toISOString().split("T")[0];

      if (date.getDay() >= 1 && date.getDay() <= 5) {
        if (Math.random() > 0.3) {
          freeSlots.push({ date: dateStr, dayOfWeek, startTime: "18:00", endTime: "23:00" });
        }
      }

      if (date.getDay() === 0 || date.getDay() === 6) {
        freeSlots.push({ date: dateStr, dayOfWeek, startTime: "10:00", endTime: "23:59" });
      }
    }

    availabilities.push({ name, freeSlots });
  }

  return availabilities;
}

export function findOverlappingFreeSlots(
  availabilities: CalendarAvailability[],
  preferredDays?: string[]
): OverlappingSlot[] {
  if (availabilities.length === 0) return [];

  const slotMap: Map<string, { count: number; slot: OverlappingSlot }> = new Map();

  for (const slot of availabilities[0].freeSlots) {
    const key = `${slot.date}_${slot.startTime}`;
    slotMap.set(key, {
      count: 1,
      slot: { date: slot.date, dayOfWeek: slot.dayOfWeek } as OverlappingSlot,
    });
  }

  for (let i = 1; i < availabilities.length; i++) {
    for (const slot of availabilities[i].freeSlots) {
      const key = `${slot.date}_${slot.startTime}`;
      if (slotMap.has(key)) slotMap.get(key)!.count++;
    }
  }

  let overlapping = Array.from(slotMap.values())
    .filter((entry) => entry.count === availabilities.length)
    .map((entry) => entry.slot);

  if (preferredDays && preferredDays.length > 0) {
    const prefLower = preferredDays.map((d) => d.toLowerCase());
    const filtered = overlapping.filter((slot) =>
      prefLower.some(
        (pref) =>
          slot.dayOfWeek.toLowerCase().includes(pref) ||
          pref.includes("weekend") &&
            (slot.dayOfWeek.toLowerCase().includes("sat") ||
              slot.dayOfWeek.toLowerCase().includes("sun"))
      )
    );
    if (filtered.length > 0) overlapping = filtered;
  }

  return overlapping.slice(0, 10);
}