// =============================================
// TixAgent — Event Matching Tool
// Filters & ranks events against user preferences
// =============================================

import {
  ScrapedEvent,
  UserIntent,
  EventMatch,
  OverlappingSlot,
} from "@/types";

/**
 * Parse event date string into a real Date object.
 * Handles formats from enrichEventDates: "Feb 25", "Mar 7", etc.
 * Also handles ISO "YYYY-MM-DD" from static data.
 */
function parseEventDate(dateStr: string, timeStr?: string): Date | null {
  if (!dateStr) return null;

  // Try ISO format first (e.g., "2026-02-28")
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime()) && dateStr.includes("-")) {
    return isoDate;
  }

  // Parse "Feb 25", "Mar 7" etc — assume current year
  const monthDayMatch = dateStr.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i
  );
  if (monthDayMatch) {
    const [, monthStr, dayStr] = monthDayMatch;
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = months[monthStr.toLowerCase()];
    const day = parseInt(dayStr);
    const year = new Date().getFullYear();
    const date = new Date(year, month, day);

    // Add time if available (e.g., "6:30 PM", "11:00PM")
    if (timeStr) {
      const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const ampm = timeMatch[3].toUpperCase();
        if (ampm === "PM" && hours !== 12) hours += 12;
        if (ampm === "AM" && hours === 12) hours = 0;
        date.setHours(hours, minutes);
      }
    }

    return date;
  }

  return null;
}

/**
 * Detect what time range the user wants and return start/end dates.
 * Returns null if no time constraint detected.
 */
function detectTimeRange(intent: UserIntent): { start: Date; end: Date } | null {
  const notes = (intent.additionalNotes || "").toLowerCase();
  const days = intent.preferredDays.map((d) => d.toLowerCase());

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // "next 10 days" / "within 5 days" / "next 3 days" / "in the next 14 days"
  const nDaysMatch = notes.match(/(?:next|within|in)\s+(\d+)\s*days/i);
  if (nDaysMatch) {
    const numDays = parseInt(nDaysMatch[1]);
    const end = new Date(now);
    end.setDate(now.getDate() + numDays);
    end.setHours(23, 59, 59, 999);
    return { start: now, end };
  }

  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() + diffToMonday);
  thisMonday.setHours(0, 0, 0, 0);

  const thisSunday = new Date(thisMonday);
  thisSunday.setDate(thisMonday.getDate() + 6);
  thisSunday.setHours(23, 59, 59, 999);

  const nextSunday = new Date(thisMonday);
  nextSunday.setDate(thisMonday.getDate() + 13);
  nextSunday.setHours(23, 59, 59, 999);

  // "next two weeks" / "two weeks" / "2 weeks" / "next 2 weeks"
  if (notes.match(/(?:next\s+)?(?:two|2)\s+weeks/) || notes.includes("couple of weeks")) {
    return { start: now, end: nextSunday };
  }

  // "this week and next week" / "this and next week" / "this week as well as next week"
  if (
    (notes.includes("this week") && notes.includes("next week")) ||
    (notes.includes("this week") && notes.includes("next")) ||
    notes.includes("both weeks")
  ) {
    return { start: thisMonday, end: nextSunday };
  }

  // "next week" only (not "this week")
  if (notes.includes("next week") && !notes.includes("this week")) {
    const nextMonday = new Date(thisMonday);
    nextMonday.setDate(thisMonday.getDate() + 7);
    const nextWeekSunday = new Date(nextMonday);
    nextWeekSunday.setDate(nextMonday.getDate() + 6);
    nextWeekSunday.setHours(23, 59, 59, 999);
    return { start: nextMonday, end: nextWeekSunday };
  }

  // "this week" only
  if (notes.includes("this week")) {
    return { start: thisMonday, end: thisSunday };
  }

  // "this month"
  if (notes.includes("this month")) {
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start: now, end: endOfMonth };
  }

  // "this weekend" or weekend preference → this week's Sat-Sun
  if (
    days.includes("weekend") || days.includes("this weekend") ||
    notes.includes("this weekend") || notes.includes("weekend")
  ) {
    const saturday = new Date(thisMonday);
    saturday.setDate(thisMonday.getDate() + 5);
    saturday.setHours(0, 0, 0, 0);
    return { start: saturday, end: thisSunday };
  }

  // "today" / "tonight"
  if (notes.includes("today") || notes.includes("tonight")) {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    return { start: now, end: endOfDay };
  }

  // "tomorrow"
  if (notes.includes("tomorrow")) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const endTomorrow = new Date(tomorrow);
    endTomorrow.setHours(23, 59, 59, 999);
    return { start: tomorrow, end: endTomorrow };
  }

  // Generic "week" mention without specifics → assume next 7 days
  if (notes.includes("week")) {
    const sevenDays = new Date(now);
    sevenDays.setDate(now.getDate() + 7);
    sevenDays.setHours(23, 59, 59, 999);
    return { start: now, end: sevenDays };
  }

  // No time constraint detected
  return null;
}

/**
 * Match events against user intent and calendar availability.
 * Returns scored and ranked event matches.
 */
export function matchEvents(
  events: ScrapedEvent[],
  intent: UserIntent,
  freeSlots?: OverlappingSlot[]
): EventMatch[] {
  let matches: EventMatch[] = [];
  const timeRange = detectTimeRange(intent);

  for (const event of events) {
    const { score, reasons, calendarMatch, matchingSlot } = scoreEvent(
      event,
      intent,
      freeSlots,
      timeRange
    );

    // Only include events with a positive score
    if (score > 0) {
      matches.push({
        event,
        score,
        reasons,
        calendarMatch,
        matchingSlot,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  // Return top 15 matches
  return matches.slice(0, 15);
}

/**
 * Score a single event against user criteria.
 */
function scoreEvent(
  event: ScrapedEvent,
  intent: UserIntent,
  freeSlots?: OverlappingSlot[],
  timeRange?: { start: Date; end: Date } | null
): {
  score: number;
  reasons: string[];
  calendarMatch: boolean;
  matchingSlot?: OverlappingSlot;
} {
  let score = 0;
  const reasons: string[] = [];
  let calendarMatch = false;
  let matchingSlot: OverlappingSlot | undefined;

  // --- Parse event date ---
  const eventDate = parseEventDate(event.date, event.time);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // --- Past event filter (hard) ---
  if (eventDate && eventDate < today) {
    return { score: 0, reasons: ["Event already passed"], calendarMatch: false };
  }

  // --- "Time range" filter (hard) ---
  if (timeRange && eventDate) {
    if (eventDate < timeRange.start || eventDate > timeRange.end) {
      return { score: 0, reasons: ["Outside requested time range"], calendarMatch: false };
    }
    score += 15;
    reasons.push("📆 Within requested dates");
  } else if (timeRange && !eventDate) {
    // If we need a time range but can't parse the date, exclude
    return { score: 0, reasons: ["Could not determine event date"], calendarMatch: false };
  }

  // --- Budget Check (hard filter) ---
  if (intent.budget !== null && event.price > intent.budget) {
    return { score: 0, reasons: ["Over budget"], calendarMatch: false };
  }

  // Budget match bonus
  if (intent.budget !== null && event.price <= intent.budget) {
    score += 20;
    if (event.isFree) {
      reasons.push("🆓 Free event — no cost!");
      score += 10;
    } else {
      reasons.push(`💰 Within budget ($${event.price} < $${intent.budget})`);
    }
  }

  // --- Free event filter ---
  // If user specifically asks for free events
  const notes = (intent.additionalNotes || "").toLowerCase();
  if (notes.includes("free") && !event.isFree) {
    return { score: 0, reasons: ["Not a free event"], calendarMatch: false };
  }
  if (notes.includes("free") && event.isFree) {
    score += 25;
    reasons.push("🆓 Free event!");
  }

  // --- Paid event filter ---
  // If user specifically asks for paid events, exclude only confirmed free events
  // (Don't exclude events where price fetch may have failed — price=0 with no explicit "free" marker)
  if ((notes.includes("paid") || notes.includes("ticketed")) && event.isFree && event.price === 0) {
    // Only exclude if the event was explicitly marked free (not just default 0)
    // Events that failed price fetch will have price=0 but may actually be paid
    // Check if description mentions "free" or "RSVP" without cover
    const desc = (event.description || "").toLowerCase();
    if (desc.includes("free") || desc.includes("no cover") || desc.includes("no charge")) {
      return { score: 0, reasons: ["Free event — user wants paid"], calendarMatch: false };
    }
    // Otherwise, keep it — might be paid but price fetch failed
    score += 5;
  }

  // --- Day Preference ---
  if (intent.preferredDays.length > 0) {
    const preferred = intent.preferredDays.map((d) => d.toLowerCase());

    // Handle "weekend" preference
    const wantsWeekend = preferred.includes("weekend") || preferred.includes("this weekend");
    const eventDow = event.dayOfWeek?.toLowerCase() || "";
    const isWeekend = eventDow.startsWith("sat") || eventDow.startsWith("sun");

    if (wantsWeekend && isWeekend) {
      score += 25;
      reasons.push(`📅 Weekend event (${event.dayOfWeek})`);
    } else if (
      eventDow &&
      preferred.some(
        (p) => eventDow.startsWith(p.slice(0, 3)) || p.startsWith(eventDow.slice(0, 3))
      )
    ) {
      score += 25;
      reasons.push(`📅 On preferred day (${event.dayOfWeek})`);
    } else if (eventDow && !wantsWeekend) {
      // Non-preferred day — slight penalty but don't exclude
      score += 5;
    }
  } else {
    score += 10; // No day preference = all days equally good
  }

  // --- Genre Match ---
  if (intent.genres.length > 0 && event.genre) {
    const eventGenre = event.genre.toLowerCase();
    const matchedGenre = intent.genres.find(
      (g) =>
        eventGenre.includes(g.toLowerCase()) ||
        g.toLowerCase().includes(eventGenre)
    );
    if (matchedGenre) {
      score += 20;
      reasons.push(`🎵 Genre match (${event.genre})`);
    }
  }

  // --- Calendar Availability ---
  if (intent.checkCalendar && freeSlots && freeSlots.length > 0) {
    const slot = freeSlots.find((s) => {
      // Try matching parsed dates
      const slotDate = parseEventDate(s.date);
      if (slotDate && eventDate) {
        return (
          slotDate.getFullYear() === eventDate.getFullYear() &&
          slotDate.getMonth() === eventDate.getMonth() &&
          slotDate.getDate() === eventDate.getDate()
        );
      }
      // Fallback to string match
      return s.date === event.date;
    });

    if (slot) {
      score += 30;
      calendarMatch = true;
      matchingSlot = slot;
      reasons.push(
        `✅ All attendees are free on ${slot.dayOfWeek}, ${slot.date}`
      );
    } else {
      score -= 20;
      reasons.push(`⚠️ Possible calendar conflict`);
    }
  }

  // --- Date Proximity Bonus ---
  if (eventDate) {
    const daysAway = Math.ceil(
      (eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysAway >= 0 && daysAway <= 14) {
      score += Math.max(0, 15 - daysAway);
      if (daysAway <= 7) {
        reasons.push(`📆 Coming up soon (in ${daysAway} days)`);
      }
    }
  }

  // --- Base score for being a valid event ---
  if (score > 0) {
    score += 10;
  }

  return { score, reasons, calendarMatch, matchingSlot };
}

/**
 * Format matched events into a readable string for the agent's response.
 */
export function formatMatchResults(matches: EventMatch[]): string {
  if (matches.length === 0) {
    return "No events matched your criteria. Try broadening your search (different dates, higher budget, etc).";
  }

  let result = `I found ${matches.length} event(s) that match your preferences:\n\n`;

  matches.forEach((match, index) => {
    const e = match.event;
    result += `**${index + 1}. ${e.name}**\n`;
    result += `   📍 ${e.venue}\n`;
    result += `   📅 ${e.dayOfWeek || "TBA"}, ${e.date || "TBA"} at ${e.time || "TBA"}\n`;
    result += `   💰 ${e.isFree ? "FREE" : `$${e.price}`}\n`;
    if (e.genre) result += `   🎵 ${e.genre}\n`;
    result += `   Score: ${match.score}/100\n`;
    result += `   ${match.reasons.join(" | ")}\n\n`;
  });

  result += `Would you like me to book tickets for any of these? Just say which one (or "book #1").`;

  return result;
}