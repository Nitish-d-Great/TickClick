// =============================================
// TixAgent — Calendar Availability Tool
// Checks Google Calendar FreeBusy for attendees
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

/**
 * Check calendar availability for a specific event time using Google Calendar FreeBusy API.
 * Called from the server side — makes a direct request to the FreeBusy endpoint.
 */
export async function checkCalendarForEvent(
  calendarToken: string,
  attendeeEmails: string[],
  eventDate: string,    // e.g., "Feb 28"
  eventTime: string,    // e.g., "11:00 PM"
  eventDayOfWeek?: string
): Promise<CalendarCheckResult> {
  if (!calendarToken || attendeeEmails.length === 0) {
    return { success: false, attendees: [], allFree: true, error: "No calendar token or emails" };
  }

  // Parse event date/time into ISO format
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
    // Call Google Calendar FreeBusy API directly
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

/**
 * Parse event date/time strings into ISO time range.
 * Input: "Feb 28", "11:00 PM" → { timeMin: "2026-02-28T22:30:00Z", timeMax: "2026-03-01T02:00:00Z" }
 * We check 30 min before event start to 3 hours after (typical event window).
 */
function parseEventTimeRange(
  dateStr: string,
  timeStr: string
): { timeMin: string | null; timeMax: string | null } {
  try {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };

    // Parse "Feb 28", "Mar 7" etc
    const dateMatch = dateStr.match(
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i
    );
    if (!dateMatch) return { timeMin: null, timeMax: null };

    const month = months[dateMatch[1].toLowerCase()];
    const day = parseInt(dateMatch[2]);
    const year = new Date().getFullYear();

    // Parse "11:00 PM", "6:30 PM" etc
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!timeMatch) return { timeMin: null, timeMax: null };

    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const ampm = timeMatch[3].toUpperCase();

    if (ampm === "PM" && hours !== 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    // Create start time (30 min before event)
    const eventStart = new Date(year, month, day, hours, minutes);
    const checkStart = new Date(eventStart.getTime() - 30 * 60 * 1000); // 30 min before
    const checkEnd = new Date(eventStart.getTime() + 3 * 60 * 60 * 1000); // 3 hours after

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

/**
 * Generate mock calendar availability for demo purposes.
 */
export function getMockAvailability(
  attendeeNames: string[]
): CalendarAvailability[] {
  const today = new Date();
  const availabilities: CalendarAvailability[] = [];

  for (const name of attendeeNames) {
    const freeSlots = [];

    // Generate free slots for next 14 days
    for (let i = 0; i < 14; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long" });
      const dateStr = date.toISOString().split("T")[0];

      // Weekdays: free evenings (6PM-11PM)
      if (date.getDay() >= 1 && date.getDay() <= 5) {
        // Randomly skip some days
        if (Math.random() > 0.3) {
          freeSlots.push({
            date: dateStr,
            dayOfWeek,
            startTime: "18:00",
            endTime: "23:00",
          });
        }
      }

      // Weekends: free most of the day
      if (date.getDay() === 0 || date.getDay() === 6) {
        freeSlots.push({
          date: dateStr,
          dayOfWeek,
          startTime: "10:00",
          endTime: "23:59",
        });
      }
    }

    availabilities.push({ name, freeSlots });
  }

  return availabilities;
}

/**
 * Find overlapping free slots across all attendees (mock version).
 */
export function findOverlappingFreeSlots(
  availabilities: CalendarAvailability[],
  preferredDays?: string[]
): OverlappingSlot[] {
  if (availabilities.length === 0) return [];

  const slotMap: Map<string, { count: number; slot: OverlappingSlot }> =
    new Map();

  // Use first attendee's slots as base
  for (const slot of availabilities[0].freeSlots) {
    const key = `${slot.date}_${slot.startTime}`;
    slotMap.set(key, {
      count: 1,
      slot: {
        date: slot.date,
        dayOfWeek: slot.dayOfWeek,
      } as OverlappingSlot,
    });
  }

  // Check other attendees
  for (let i = 1; i < availabilities.length; i++) {
    const attendee = availabilities[i];
    for (const slot of attendee.freeSlots) {
      const key = `${slot.date}_${slot.startTime}`;
      if (slotMap.has(key)) {
        const entry = slotMap.get(key)!;
        entry.count++;
      }
    }
  }

  // Filter to only fully overlapping slots
  let overlapping = Array.from(slotMap.values())
    .filter((entry) => entry.count === availabilities.length)
    .map((entry) => entry.slot);

  // Filter by preferred days if specified
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