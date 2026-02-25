// =============================================
// TickClick — Dynamic cNFT Metadata Endpoint
// GET /api/ticket-metadata?e=EventName&a=Attendee&v=Venue&d=Date&p=Price&img=ImageURL
// Returns Metaplex-standard JSON metadata for cNFT tickets
// =============================================

import { NextRequest, NextResponse } from "next/server";

// KYD venue poster images (fallbacks)
const VENUE_POSTERS: Record<string, string> = {
  "poisson rouge":
    "https://images.unsplash.com/photo-1501386761578-0a55d8f28b23?w=600&q=80",
  lpr: "https://images.unsplash.com/photo-1501386761578-0a55d8f28b23?w=600&q=80",
  "mike nasty":
    "https://images.unsplash.com/photo-1571266028243-3716f02d2d58?w=600&q=80",
  djmikenasty:
    "https://images.unsplash.com/photo-1571266028243-3716f02d2d58?w=600&q=80",
};

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=600&q=80";

function getImage(venue: string, imageParam?: string): string {
  if (imageParam) return imageParam;
  const key = venue.toLowerCase().trim();
  for (const [venueKey, url] of Object.entries(VENUE_POSTERS)) {
    if (key.includes(venueKey)) return url;
  }
  return DEFAULT_IMAGE;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const event = searchParams.get("e") || searchParams.get("event") || "TickClick Event";
  const attendee = searchParams.get("a") || searchParams.get("attendee") || "Attendee";
  const venue = searchParams.get("v") || searchParams.get("venue") || "KYD Labs Venue";
  const date = searchParams.get("d") || searchParams.get("date") || "TBA";
  const price = searchParams.get("p") || searchParams.get("price") || "0";
  const image = searchParams.get("img") || searchParams.get("image") || "";

  const posterImage = getImage(venue, image || undefined);

  // Metaplex Token Metadata Standard
  const metadata = {
    name: `${event} — ${attendee}`.slice(0, 32),
    symbol: "TICK",
    description: `TickClick cNFT Ticket | ${event} at ${venue}. Attendee: ${attendee}. Date: ${date}. Price: ${price === "0" ? "FREE" : `$${price}`}. Minted on Solana devnet via Metaplex Bubblegum.`,
    image: posterImage,
    external_url: "https://tickclick.xyz",
    attributes: [
      { trait_type: "Event", value: event },
      { trait_type: "Venue", value: venue },
      { trait_type: "Date", value: date },
      { trait_type: "Attendee", value: attendee },
      { trait_type: "Price", value: price === "0" ? "FREE" : `$${price}` },
      { trait_type: "Platform", value: "TickClick" },
      { trait_type: "Network", value: "Solana Devnet" },
    ],
    properties: {
      category: "ticket",
      files: [
        {
          uri: posterImage,
          type: "image/jpeg",
        },
      ],
    },
  };

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "application/json",
    },
  });
}