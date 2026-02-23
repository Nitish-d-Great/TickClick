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
 * Match events against user intent and calendar availability.
 * Returns scored and ranked event matches.
 */
export function matchEvents(
  events: ScrapedEvent[],
  intent: UserIntent,
  freeSlots?: OverlappingSlot[]
): EventMatch[] {
  let matches: EventMatch[] = [];

  for (const event of events) {
    const { score, reasons, calendarMatch, matchingSlot } = scoreEvent(
      event,
      intent,
      freeSlots
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

  // Return top 5 matches
  return matches.slice(0, 5);
}

/**
 * Score a single event against user criteria.
 */
function scoreEvent(
  event: ScrapedEvent,
  intent: UserIntent,
  freeSlots?: OverlappingSlot[]
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

  // --- Day Preference ---
  if (intent.preferredDays.length > 0) {
    const preferred = intent.preferredDays.map((d) => d.toLowerCase());
    if (event.dayOfWeek && preferred.includes(event.dayOfWeek.toLowerCase())) {
      score += 25;
      reasons.push(`📅 On preferred day (${event.dayOfWeek})`);
    } else if (event.dayOfWeek) {
      // Slight penalty for non-preferred day, but don't exclude
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
    // Check if event date matches any free slot
    const eventDate = event.date; // YYYY-MM-DD format

    const slot = freeSlots.find((s) => s.date === eventDate);
    if (slot) {
      score += 30;
      calendarMatch = true;
      matchingSlot = slot;
      reasons.push(
        `✅ All attendees are free on ${slot.dayOfWeek}, ${slot.date}`
      );
    } else {
      // Calendar conflict — heavy penalty but don't exclude entirely
      score -= 20;
      reasons.push(`⚠️ Possible calendar conflict on ${eventDate}`);
    }
  }

  // --- Date Proximity Bonus ---
  // Prefer events happening sooner (within next 2 weeks)
  if (event.date) {
    const eventDate = new Date(event.date);
    const today = new Date();
    const daysAway = Math.ceil(
      (eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysAway >= 0 && daysAway <= 14) {
      score += Math.max(0, 15 - daysAway); // Closer = higher score
      if (daysAway <= 7) {
        reasons.push(`📆 Coming up soon (in ${daysAway} days)`);
      }
    } else if (daysAway < 0) {
      // Event already passed
      return { score: 0, reasons: ["Event already passed"], calendarMatch: false };
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
    return "I couldn't find any events matching your criteria. Would you like to broaden your search?";
  }

  let result = `I found ${matches.length} event(s) that match your preferences:\n\n`;

  matches.forEach((match, index) => {
    const e = match.event;
    result += `**${index + 1}. ${e.name}**\n`;
    result += `   📍 ${e.venue}\n`;
    result += `   📅 ${e.dayOfWeek}, ${e.date} at ${e.time}\n`;
    result += `   💰 ${e.isFree ? "FREE" : `$${e.price}`}\n`;
    if (e.genre) result += `   🎵 ${e.genre}\n`;
    result += `   Score: ${match.score}/100\n`;
    result += `   ${match.reasons.join(" | ")}\n\n`;
  });

  result += `Would you like me to book tickets for any of these? Just say which one (or "book #1").`;

  return result;
}
