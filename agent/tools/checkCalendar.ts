// =============================================
// TixAgent — Google Calendar Tool
// Checks free/busy slots for multiple attendees
// =============================================

import { google } from "googleapis";
import {
  AttendeeAvailability,
  CalendarSlot,
  OverlappingSlot,
} from "@/types";

// --- OAuth2 Setup ---

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate the Google OAuth2 authorization URL.
 * User visits this URL to grant calendar access.
 */
export function getAuthUrl(): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.readonly"],
    prompt: "consent",
  });
}

/**
 * Exchange authorization code for tokens.
 */
export async function getTokens(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// --- Free/Busy Check ---

/**
 * Check free/busy status for a single user's calendar.
 * Returns their availability for the next 14 days.
 */
export async function checkCalendarAvailability(
  accessToken: string,
  attendeeName: string,
  attendeeEmail: string,
  lookAheadDays: number = 14
): Promise<AttendeeAvailability> {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const timeMin = new Date();
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + lookAheadDays);

  try {
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: "America/New_York", // LPR is in NYC
        items: [{ id: attendeeEmail }],
      },
    });

    const busySlots =
      response.data.calendars?.[attendeeEmail]?.busy || [];

    // Convert busy slots to free slots
    const freeSlots = computeFreeSlots(
      timeMin,
      timeMax,
      busySlots.map((b) => ({
        start: b.start || "",
        end: b.end || "",
      }))
    );

    return {
      name: attendeeName,
      email: attendeeEmail,
      freeSlots,
    };
  } catch (error) {
    console.error(`Calendar check failed for ${attendeeName}:`, error);
    // Return all slots as free if calendar check fails
    return {
      name: attendeeName,
      email: attendeeEmail,
      freeSlots: generateAllSlots(timeMin, timeMax),
    };
  }
}

/**
 * Find overlapping free slots between multiple attendees.
 * Only returns evening slots (5 PM - 11:59 PM) since these are concert times.
 */
export function findOverlappingFreeSlots(
  attendees: AttendeeAvailability[],
  preferredDays?: string[]
): OverlappingSlot[] {
  if (attendees.length === 0) return [];

  // Start with first attendee's free slots
  let overlapping = attendees[0].freeSlots.filter((slot) => slot.isFree);

  // Intersect with each subsequent attendee
  for (let i = 1; i < attendees.length; i++) {
    const theirFreeSlots = attendees[i].freeSlots.filter((s) => s.isFree);
    overlapping = overlapping.filter((slot) =>
      theirFreeSlots.some(
        (their) =>
          new Date(slot.start) >= new Date(their.start) &&
          new Date(slot.end) <= new Date(their.end)
      )
    );
  }

  // Convert to OverlappingSlot format
  let results: OverlappingSlot[] = overlapping.map((slot) => {
    const date = new Date(slot.start);
    return {
      date: date.toISOString().split("T")[0],
      dayOfWeek: date.toLocaleDateString("en-US", { weekday: "long" }),
      start: slot.start,
      end: slot.end,
      attendees: attendees.map((a) => a.name),
    };
  });

  // Filter by preferred days if specified
  if (preferredDays && preferredDays.length > 0) {
    const preferred = preferredDays.map((d) => d.toLowerCase());
    results = results.filter((slot) =>
      preferred.includes(slot.dayOfWeek.toLowerCase())
    );
  }

  return results;
}

// --- Helper Functions ---

function computeFreeSlots(
  rangeStart: Date,
  rangeEnd: Date,
  busySlots: { start: string; end: string }[]
): CalendarSlot[] {
  const freeSlots: CalendarSlot[] = [];
  const sortedBusy = busySlots.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  // Generate day-by-day evening slots (5 PM - 11:59 PM)
  const current = new Date(rangeStart);
  while (current < rangeEnd) {
    const eveningStart = new Date(current);
    eveningStart.setHours(17, 0, 0, 0); // 5 PM

    const eveningEnd = new Date(current);
    eveningEnd.setHours(23, 59, 0, 0); // 11:59 PM

    if (eveningStart > rangeStart) {
      // Check if this evening slot overlaps with any busy period
      const isBusy = sortedBusy.some((busy) => {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        return busyStart < eveningEnd && busyEnd > eveningStart;
      });

      freeSlots.push({
        start: eveningStart.toISOString(),
        end: eveningEnd.toISOString(),
        isFree: !isBusy,
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return freeSlots;
}

function generateAllSlots(start: Date, end: Date): CalendarSlot[] {
  const slots: CalendarSlot[] = [];
  const current = new Date(start);

  while (current < end) {
    const eveningStart = new Date(current);
    eveningStart.setHours(17, 0, 0, 0);
    const eveningEnd = new Date(current);
    eveningEnd.setHours(23, 59, 0, 0);

    slots.push({
      start: eveningStart.toISOString(),
      end: eveningEnd.toISOString(),
      isFree: true,
    });

    current.setDate(current.getDate() + 1);
  }

  return slots;
}

// --- Mock Calendar Data (for demo without OAuth) ---

/**
 * Returns mock availability for demo purposes.
 * In production, this is replaced by real Google Calendar API calls.
 */
export function getMockAvailability(
  attendeeNames: string[]
): AttendeeAvailability[] {
  const today = new Date();

  return attendeeNames.map((name) => {
    const slots: CalendarSlot[] = [];

    for (let i = 0; i < 14; i++) {
      const day = new Date(today);
      day.setDate(day.getDate() + i);

      const eveningStart = new Date(day);
      eveningStart.setHours(17, 0, 0, 0);
      const eveningEnd = new Date(day);
      eveningEnd.setHours(23, 59, 0, 0);

      // Simulate: busy on some weekday evenings, free on weekends
      const dayOfWeek = day.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isFree = isWeekend || Math.random() > 0.4;

      slots.push({
        start: eveningStart.toISOString(),
        end: eveningEnd.toISOString(),
        isFree,
      });
    }

    return {
      name,
      email: `${name.toLowerCase()}@example.com`,
      freeSlots: slots,
    };
  });
}
