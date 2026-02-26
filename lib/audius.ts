// =============================================
// TickClick — Audius Integration
// Search artists, get tracks, trending by genre
// Uses Audius REST API (free, no auth required)
// =============================================

const AUDIUS_API_BASE = "https://api.audius.co";
const APP_NAME = "tickclick";

// --- Types ---

export interface AudiusTrack {
  id: string;
  title: string;
  artistName: string;
  artistHandle: string;
  artwork: string; // 480x480 artwork URL
  duration: number; // seconds
  permalink: string; // e.g. /artist/track-slug
  genre: string;
  playCount: number;
  favoriteCount: number;
}

export interface AudiusArtist {
  id: string;
  name: string;
  handle: string;
  bio: string;
  profilePicture: string;
  followerCount: number;
  trackCount: number;
  isVerified: boolean;
}

export interface AudiusDiscoveryResult {
  tracks: AudiusTrack[];
  artist: AudiusArtist | null;
  genre: string;
  source: "artist_match" | "genre_trending"; // how tracks were found
  audiusProfileUrl: string | null; // link to artist's Audius page
  embedTrackId: string | null; // first track ID for iframe embed
}

// --- API Helpers ---

/**
 * Get a working Audius API host.
 * The /v1 endpoints are available directly on api.audius.co
 */
async function getApiHost(): Promise<string> {
  return AUDIUS_API_BASE;
}

/**
 * Make a GET request to the Audius API
 */
async function audiusFetch(endpoint: string): Promise<any> {
  const host = await getApiHost();
  const separator = endpoint.includes("?") ? "&" : "?";
  const url = `${host}${endpoint}${separator}app_name=${APP_NAME}`;

  console.log(`   [Audius API] GET ${url}`);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000), // 8s timeout
  });

  if (!response.ok) {
    throw new Error(`Audius API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return json.data;
}

// --- Core Functions ---

/**
 * Search for an artist on Audius by name.
 * Returns the best matching artist or null.
 */
export async function searchArtist(
  artistName: string
): Promise<AudiusArtist | null> {
  try {
    const data = await audiusFetch(
      `/v1/users/search?query=${encodeURIComponent(artistName)}`
    );

    if (!data || data.length === 0) return null;

    // Find best match — prefer exact name match or verified artists
    const normalized = artistName.toLowerCase().trim();
    const match =
      data.find(
        (u: any) =>
          u.name.toLowerCase().trim() === normalized && u.is_verified
      ) ||
      data.find((u: any) => u.name.toLowerCase().trim() === normalized) ||
      data.find(
        (u: any) =>
          u.name.toLowerCase().includes(normalized) ||
          normalized.includes(u.name.toLowerCase())
      ) ||
      data[0]; // fallback to top result

    // Only return if it's a reasonable match (has tracks)
    if (match.track_count === 0) return null;

    return {
      id: match.id,
      name: match.name,
      handle: match.handle,
      bio: match.bio || "",
      profilePicture: match.profile_picture?.["480x480"] || "",
      followerCount: match.follower_count || 0,
      trackCount: match.track_count || 0,
      isVerified: match.is_verified || false,
    };
  } catch (error) {
    console.error(`   [Audius] Artist search failed:`, error);
    return null;
  }
}

/**
 * Get tracks by a specific artist.
 * Returns up to `limit` tracks sorted by play count.
 */
export async function getArtistTracks(
  userId: string,
  limit: number = 5
): Promise<AudiusTrack[]> {
  try {
    const data = await audiusFetch(
      `/v1/users/${userId}/tracks?limit=${limit}&sort=plays`
    );

    if (!data || data.length === 0) return [];

    return data.slice(0, limit).map(mapTrack);
  } catch (error) {
    console.error(`   [Audius] Get artist tracks failed:`, error);
    return [];
  }
}

/**
 * Get trending tracks, optionally filtered by genre.
 * Audius genres: Electronic, Rock, Metal, Alternative, Hip-Hop/Rap,
 * Experimental, Punk, Folk, Pop, Ambient, Soundtrack, World,
 * Jazz & Blues, Soul, Tech House, Deep House, House, R&B/Soul
 */
export async function getTrendingTracks(
  genre?: string,
  limit: number = 5
): Promise<AudiusTrack[]> {
  try {
    let endpoint = `/v1/tracks/trending?limit=${limit}`;
    if (genre) {
      endpoint += `&genre=${encodeURIComponent(genre)}`;
    }

    const data = await audiusFetch(endpoint);

    if (!data || data.length === 0) {
      // If genre-specific trending returns nothing, try without genre
      if (genre) {
        console.log(
          `   [Audius] No trending for genre "${genre}", falling back to all trending`
        );
        return getTrendingTracks(undefined, limit);
      }
      return [];
    }

    return data.slice(0, limit).map(mapTrack);
  } catch (error) {
    console.error(`   [Audius] Get trending tracks failed:`, error);
    return [];
  }
}

/**
 * Search for tracks by query string.
 * Useful as additional fallback.
 */
export async function searchTracks(
  query: string,
  limit: number = 5
): Promise<AudiusTrack[]> {
  try {
    const data = await audiusFetch(
      `/v1/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}`
    );

    if (!data || data.length === 0) return [];

    return data.slice(0, limit).map(mapTrack);
  } catch (error) {
    console.error(`   [Audius] Track search failed:`, error);
    return [];
  }
}

// --- Discovery Orchestrator ---

/**
 * Main discovery function. Tries to find music related to an event.
 *
 * Strategy:
 * 1. Search Audius for the artist name
 * 2. If found → return their top tracks
 * 3. If not found → use the provided genre to get trending tracks
 *
 * The genre inference (via LLM) happens in the API route, not here.
 */
export async function discoverMusicForEvent(
  artistName: string,
  genre: string
): Promise<AudiusDiscoveryResult> {
  console.log(`\n   [Audius Discovery] Artist: "${artistName}", Genre: "${genre}"`);

  // Step 1: Try to find artist on Audius
  const artist = await searchArtist(artistName);

  if (artist && artist.trackCount > 0) {
    console.log(
      `   [Audius] ✅ Found artist: ${artist.name} (@${artist.handle}) — ${artist.trackCount} tracks`
    );

    // Get their tracks
    const tracks = await getArtistTracks(artist.id, 5);

    if (tracks.length > 0) {
      return {
        tracks,
        artist,
        genre: tracks[0]?.genre || genre,
        source: "artist_match",
        audiusProfileUrl: `https://audius.co/${artist.handle}`,
        embedTrackId: tracks[0]?.id || null,
      };
    }
  }

  console.log(
    `   [Audius] Artist not found or no tracks. Using genre trending: "${genre}"`
  );

  // Step 2: Get trending tracks by genre
  const tracks = await getTrendingTracks(genre, 5);

  // Step 3: If genre trending is empty, try searching by genre keyword
  if (tracks.length === 0) {
    console.log(`   [Audius] No trending for genre. Trying search...`);
    const searchResults = await searchTracks(genre, 5);
    return {
      tracks: searchResults,
      artist: null,
      genre,
      source: "genre_trending",
      audiusProfileUrl: null,
      embedTrackId: searchResults[0]?.id || null,
    };
  }

  return {
    tracks,
    artist: null,
    genre,
    source: "genre_trending",
    audiusProfileUrl: null,
    embedTrackId: tracks[0]?.id || null,
  };
}

// --- Helpers ---

/**
 * Map raw Audius API track response to our AudiusTrack type
 */
function mapTrack(track: any): AudiusTrack {
  return {
    id: track.id,
    title: track.title || "Untitled",
    artistName: track.user?.name || "Unknown Artist",
    artistHandle: track.user?.handle || "",
    artwork:
      track.artwork?.["480x480"] ||
      track.artwork?.["150x150"] ||
      "",
    duration: track.duration || 0,
    permalink: track.permalink || "",
    genre: track.genre || "",
    playCount: track.play_count || 0,
    favoriteCount: track.favorite_count || 0,
  };
}

/**
 * Build the Audius embed URL for an iframe player
 */
export function getEmbedUrl(trackId: string, flavor: "compact" | "card" = "card"): string {
  return `https://audius.co/embed/track/${trackId}?flavor=${flavor}`;
}

/**
 * Build the Audius track page URL
 */
export function getTrackUrl(permalink: string): string {
  return `https://audius.co${permalink}`;
}

/**
 * Audius-supported genres for the trending endpoint
 */
export const AUDIUS_GENRES = [
  "Electronic",
  "Rock",
  "Metal",
  "Alternative",
  "Hip-Hop/Rap",
  "Experimental",
  "Punk",
  "Folk",
  "Pop",
  "Ambient",
  "Soundtrack",
  "World",
  "Jazz & Blues",
  "Soul",
  "Tech House",
  "Deep House",
  "House",
  "R&B/Soul",
] as const;