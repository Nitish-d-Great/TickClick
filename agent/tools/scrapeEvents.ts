// =============================================
// TixAgent — Event Scraper Tool
// Scrapes KYD-powered venue websites for event data
// Targets: lpr.kydlabs.com, djmikenasty.kydlabs.com
// =============================================

import puppeteer, { Browser, Page } from "puppeteer";
import { ScrapedEvent } from "@/types";

// --- KYD Venue Registry ---

const KYD_VENUES = [
  {
    name: "Le Poisson Rouge",
    url: "https://lpr.kydlabs.com",
    shortName: "LPR",
  },
  {
    name: "DJ Mike Nasty",
    url: "https://djmikenasty.kydlabs.com",
    shortName: "DJMikeNasty",
  },
];

// --- Main Scraper ---

export async function scrapeAllVenues(): Promise<ScrapedEvent[]> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let allEvents: ScrapedEvent[] = [];

  for (const venue of KYD_VENUES) {
    try {
      console.log(`🔍 Scraping ${venue.name} (${venue.url})...`);
      const events = await scrapeKydVenue(browser, venue);
      allEvents = [...allEvents, ...events];
      console.log(`   Found ${events.length} events at ${venue.name}`);
    } catch (error) {
      console.error(`❌ Error scraping ${venue.name}:`, error);
    }
  }

  await browser.close();
  console.log(`\n✅ Total events scraped: ${allEvents.length}`);
  return allEvents;
}

export async function scrapeKydVenue(
  browser: Browser,
  venue: { name: string; url: string; shortName: string }
): Promise<ScrapedEvent[]> {
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
  );

  try {
    // Navigate to venue page and wait for JS to render
    await page.goto(venue.url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for event listings to load
    await page.waitForSelector("body", { timeout: 10000 });

    // Give extra time for dynamic content
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Extract event data from the page
    const events = await page.evaluate(
      (venueName: string, venueUrl: string) => {
        const eventElements: ScrapedEvent[] = [];

        // Strategy 1: Look for common event card patterns in KYD sites
        // KYD sites typically render events as cards/list items
        const possibleSelectors = [
          "[class*='event']",
          "[class*='Event']",
          "[class*='show']",
          "[class*='Show']",
          "[class*='card']",
          "[class*='Card']",
          "a[href*='/e/']", // KYD event links usually have /e/ in the path
          "[data-event]",
          ".event-item",
          ".event-card",
          ".show-card",
        ];

        // Try each selector to find event containers
        let eventNodes: Element[] = [];
        for (const selector of possibleSelectors) {
          const nodes = document.querySelectorAll(selector);
          if (nodes.length > 0) {
            eventNodes = Array.from(nodes);
            break;
          }
        }

        // If we found event nodes, parse them
        if (eventNodes.length > 0) {
          eventNodes.forEach((node, index) => {
            const text = node.textContent || "";
            const link = node.querySelector("a")?.href || 
                         (node as HTMLAnchorElement).href || "";

            // Extract event details from text content
            const nameEl =
              node.querySelector("h1, h2, h3, h4, [class*='title'], [class*='name']");
            const dateEl =
              node.querySelector("[class*='date'], [class*='Date'], time");
            const priceEl =
              node.querySelector("[class*='price'], [class*='Price'], [class*='cost']");

            const name = nameEl?.textContent?.trim() || `Event ${index + 1}`;
            const dateText = dateEl?.textContent?.trim() || "";
            const priceText = priceEl?.textContent?.trim() || "";

            // Parse price
            let price = 0;
            let isFree = false;
            if (
              priceText.toLowerCase().includes("free") ||
              priceText === "$0" ||
              priceText === ""
            ) {
              isFree = true;
              price = 0;
            } else {
              const priceMatch = priceText.match(/\$?([\d.]+)/);
              price = priceMatch ? parseFloat(priceMatch[1]) : 0;
              isFree = price === 0;
            }

            // Parse date
            let parsedDate = "";
            let dayOfWeek = "";
            let time = "";
            if (dateText) {
              try {
                const dateObj = new Date(dateText);
                if (!isNaN(dateObj.getTime())) {
                  parsedDate = dateObj.toISOString().split("T")[0];
                  dayOfWeek = dateObj.toLocaleDateString("en-US", {
                    weekday: "long",
                  });
                  time = dateObj.toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                }
              } catch {
                parsedDate = dateText;
              }
            }

            if (name && name !== `Event ${index + 1}`) {
              eventElements.push({
                id: `${venueUrl}-${index}`,
                name: name,
                artist: name, // Often the artist IS the event name
                venue: venueName,
                venueUrl: venueUrl,
                date: parsedDate,
                time: time,
                dayOfWeek: dayOfWeek,
                price: price,
                isFree: isFree,
                description: text.substring(0, 200),
                ticketUrl: link || venueUrl,
              } as ScrapedEvent);
            }
          });
        }

        // Strategy 2: Fallback — extract all text and links if no structured data
        if (eventElements.length === 0) {
          // Get all links that look like event pages
          const allLinks = document.querySelectorAll('a[href*="/e/"]');
          allLinks.forEach((link, index) => {
            const name = link.textContent?.trim() || `Event ${index + 1}`;
            const href = (link as HTMLAnchorElement).href || "";

            if (name.length > 3) {
              eventElements.push({
                id: `${venueUrl}-fallback-${index}`,
                name: name,
                artist: name,
                venue: venueName,
                venueUrl: venueUrl,
                date: "",
                time: "",
                dayOfWeek: "",
                price: 0,
                isFree: true,
                ticketUrl: href,
              } as ScrapedEvent);
            }
          });
        }

        return eventElements;
      },
      venue.name,
      venue.url
    );

    await page.close();
    return events;
  } catch (error) {
    await page.close();
    throw error;
  }
}

// --- Fallback: Static Event Data ---
// Used when scraping fails or for testing without a browser

export function getStaticEventData(): ScrapedEvent[] {
  return [
    {
      id: "lpr-static-1",
      name: "Jazz at LPR: Late Night Sessions",
      artist: "Various Artists",
      venue: "Le Poisson Rouge",
      venueUrl: "https://lpr.kydlabs.com",
      date: "2026-03-01",
      time: "9:00 PM",
      dayOfWeek: "Saturday",
      price: 25,
      isFree: false,
      genre: "Jazz",
      description: "An intimate evening of jazz performances at NYC's iconic Le Poisson Rouge.",
      ticketUrl: "https://lpr.kydlabs.com",
    },
    {
      id: "lpr-static-2",
      name: "Indie Showcase: Emerging Artists",
      artist: "Multiple Artists",
      venue: "Le Poisson Rouge",
      venueUrl: "https://lpr.kydlabs.com",
      date: "2026-03-07",
      time: "8:00 PM",
      dayOfWeek: "Saturday",
      price: 35,
      isFree: false,
      genre: "Indie",
      description: "Discover the next wave of indie talent at Le Poisson Rouge.",
      ticketUrl: "https://lpr.kydlabs.com",
    },
    {
      id: "lpr-static-3",
      name: "Electronic Beats Night",
      artist: "DJ Collective",
      venue: "Le Poisson Rouge",
      venueUrl: "https://lpr.kydlabs.com",
      date: "2026-03-08",
      time: "10:00 PM",
      dayOfWeek: "Sunday",
      price: 45,
      isFree: false,
      genre: "Electronic",
      description: "A night of cutting-edge electronic music.",
      ticketUrl: "https://lpr.kydlabs.com",
    },
    {
      id: "djmn-static-1",
      name: "DJ Mike Nasty Live",
      artist: "DJ Mike Nasty",
      venue: "DJ Mike Nasty",
      venueUrl: "https://djmikenasty.kydlabs.com",
      date: "2026-02-28",
      time: "9:00 PM",
      dayOfWeek: "Saturday",
      price: 0,
      isFree: true,
      genre: "Hip-Hop/DJ",
      description: "Free show by DJ Mike Nasty. RSVP to claim your spot!",
      ticketUrl: "https://djmikenasty.kydlabs.com",
    },
    {
      id: "djmn-static-2",
      name: "DJ Mike Nasty — Weekend Vibes",
      artist: "DJ Mike Nasty",
      venue: "DJ Mike Nasty",
      venueUrl: "https://djmikenasty.kydlabs.com",
      date: "2026-03-07",
      time: "10:00 PM",
      dayOfWeek: "Saturday",
      price: 0,
      isFree: true,
      genre: "Hip-Hop/DJ",
      description: "Free Saturday night set. No cover, just good music.",
      ticketUrl: "https://djmikenasty.kydlabs.com",
    },
  ];
}

/**
 * Main entry point: tries live scraping first, falls back to static data.
 */
export async function discoverEvents(): Promise<ScrapedEvent[]> {
  try {
    const events = await scrapeAllVenues();
    if (events.length > 0) return enrichEventDates(events);
    console.log("⚠️ No events found via scraping, using static fallback data");
    return getStaticEventData();
  } catch (error) {
    console.error("⚠️ Scraping failed, using static fallback data:", error);
    return getStaticEventData();
  }
}

/**
 * Post-process scraped events to extract dates from description text.
 * KYD descriptions contain dates like: "Event NameWed Feb 25 6:30PMLe Poisson Rouge..."
 */
function enrichEventDates(events: ScrapedEvent[]): ScrapedEvent[] {
  return events.map((event) => {
    // Skip if date already parsed
    if (event.dayOfWeek && event.time) return event;

    const desc = event.description || "";

    // Match patterns like "Wed Feb 25 6:30PM" or "Thu Feb 26 7:00PM"
    const dateMatch = desc.match(
      /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{1,2}:\d{2})\s*(AM|PM)/i
    );

    if (dateMatch) {
      const [, day, month, dateNum, time, ampm] = dateMatch;
      event.dayOfWeek = day;
      event.date = `${month} ${dateNum}`;
      event.time = `${time} ${ampm}`;
    } else {
      // Try without AM/PM (KYD often uses "6:30PM" with no space)
      const altMatch = desc.match(
        /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{1,2}:\d{2})(AM|PM)/i
      );
      if (altMatch) {
        const [, day, month, dateNum, time, ampm] = altMatch;
        event.dayOfWeek = day;
        event.date = `${month} ${dateNum}`;
        event.time = `${time}${ampm}`;
      }
    }

    return event;
  });
}
