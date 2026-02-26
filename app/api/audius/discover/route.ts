// =============================================
// TickClick — Audius Music Discovery API
// POST /api/audius/discover
//
// Given an event's artist name and event name,
// finds relevant music on Audius.
//
// Flow:
// 1. Search Audius for the artist
// 2. If not found, infer genre via Groq LLM
// 3. Fetch trending tracks for that genre
// =============================================

import { NextRequest, NextResponse } from "next/server";
import { discoverMusicForEvent, AUDIUS_GENRES } from "@/lib/audius";

// Genre inference via Groq (raw fetch — no SDK needed)
async function inferGenre(
  artistName: string,
  eventName: string,
  venueName: string
): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;

  if (!groqApiKey) {
    console.log("   [Audius] No GROQ_API_KEY, using fallback genre: Electronic");
    return "Electronic";
  }

  try {
    const genreList = AUDIUS_GENRES.join(", ");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `You are a music genre classifier. Given an artist name and/or event name, respond with exactly ONE genre from this list: ${genreList}. Respond with ONLY the genre name, nothing else. No explanation, no punctuation, just the genre.`,
          },
          {
            role: "user",
            content: `Artist: "${artistName}", Event: "${eventName}", Venue: "${venueName}"`,
          },
        ],
        temperature: 0,
        max_tokens: 20,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const genre = data.choices?.[0]?.message?.content?.trim() || "Electronic";

    // Validate it's an actual Audius genre
    const validGenre = AUDIUS_GENRES.find(
      (g) => g.toLowerCase() === genre.toLowerCase()
    );

    if (validGenre) {
      console.log(`   [Audius] LLM inferred genre: "${validGenre}"`);
      return validGenre;
    }

    // Try partial match
    const partialMatch = AUDIUS_GENRES.find(
      (g) =>
        g.toLowerCase().includes(genre.toLowerCase()) ||
        genre.toLowerCase().includes(g.toLowerCase())
    );

    if (partialMatch) {
      console.log(
        `   [Audius] LLM partial genre match: "${genre}" → "${partialMatch}"`
      );
      return partialMatch;
    }

    console.log(
      `   [Audius] LLM returned unknown genre: "${genre}", defaulting to Electronic`
    );
    return "Electronic";
  } catch (error) {
    console.error("   [Audius] Genre inference failed:", error);
    return "Electronic";
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      artistName = "",
      eventName = "",
      venueName = "",
    } = body;

    console.log(`\n[Audius Discover] Request:`);
    console.log(`   Artist: "${artistName}"`);
    console.log(`   Event: "${eventName}"`);
    console.log(`   Venue: "${venueName}"`);

    // Step 1: Try artist name directly, with genre inference as fallback
    // First attempt discovery with a generic genre (will search artist first)
    const initialResult = await discoverMusicForEvent(artistName, "Electronic");

    // If we found the artist on Audius, return immediately
    if (initialResult.source === "artist_match" && initialResult.tracks.length > 0) {
      console.log(
        `   [Audius] ✅ Found artist match with ${initialResult.tracks.length} tracks`
      );
      return NextResponse.json(initialResult);
    }

    // Step 2: Artist not on Audius — infer genre via LLM
    const genre = await inferGenre(artistName, eventName, venueName);

    // Step 3: Get trending tracks for the inferred genre
    const result = await discoverMusicForEvent(artistName, genre);

    console.log(
      `   [Audius] Returning ${result.tracks.length} tracks (source: ${result.source}, genre: ${result.genre})`
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Audius Discover] Error:", error);
    return NextResponse.json(
      {
        tracks: [],
        artist: null,
        genre: "Electronic",
        source: "genre_trending",
        audiusProfileUrl: null,
        embedTrackId: null,
        error: error.message,
      },
      { status: 200 } // Return 200 even on error — graceful degradation
    );
  }
}