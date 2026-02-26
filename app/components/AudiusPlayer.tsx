"use client";

import { useState, useEffect } from "react";

// --- Types (inline to avoid import issues) ---

interface AudiusTrack {
  id: string;
  title: string;
  artistName: string;
  artistHandle: string;
  artwork: string;
  duration: number;
  permalink: string;
  genre: string;
  playCount: number;
  favoriteCount: number;
}

interface AudiusArtist {
  id: string;
  name: string;
  handle: string;
  bio: string;
  profilePicture: string;
  followerCount: number;
  trackCount: number;
  isVerified: boolean;
}

interface AudiusDiscoveryResult {
  tracks: AudiusTrack[];
  artist: AudiusArtist | null;
  genre: string;
  source: "artist_match" | "genre_trending";
  audiusProfileUrl: string | null;
  embedTrackId: string | null;
}

interface AudiusPlayerProps {
  artistName: string;
  eventName: string;
  venueName: string;
}

// --- Helper ---

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPlayCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

// --- Component ---

export default function AudiusPlayer({
  artistName,
  eventName,
  venueName,
}: AudiusPlayerProps) {
  const [result, setResult] = useState<AudiusDiscoveryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchMusic() {
      try {
        setLoading(true);
        const res = await fetch("/api/audius/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artistName, eventName, venueName }),
        });

        if (!res.ok) throw new Error("Failed to fetch");

        const data = await res.json();
        if (!cancelled) {
          setResult(data);
          setActiveTrackId(data.embedTrackId);
        }
      } catch (err) {
        console.error("AudiusPlayer fetch error:", err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (artistName || eventName) {
      fetchMusic();
    }

    return () => {
      cancelled = true;
    };
  }, [artistName, eventName, venueName]);

  // Don't render anything if loading or error or no tracks
  if (loading) {
    return (
      <div className="mt-4 bg-dark-800/50 border border-dark-600 rounded-xl p-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 bg-dark-600 rounded" />
          <div className="h-4 w-48 bg-dark-600 rounded" />
        </div>
        <div className="h-[120px] bg-dark-700 rounded-lg" />
        <div className="mt-3 h-3 w-32 bg-dark-600 rounded" />
      </div>
    );
  }

  if (error || !result || result.tracks.length === 0) {
    return null; // Graceful — just don't show the player
  }

  const { tracks, artist, genre, source, audiusProfileUrl } = result;

  // Header text based on source
  const headerText =
    source === "artist_match"
      ? `Music by ${artist?.name || artistName}`
      : `Trending ${genre} on Audius`;

  const subText =
    source === "artist_match"
      ? `Preview tracks before the show`
      : `Get in the mood for ${eventName}`;

  return (
    <div className="mt-4 bg-gradient-to-br from-dark-800 via-dark-800/95 to-dark-900 border border-purple-500/20 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎵</span>
          <div>
            <p className="text-white text-sm font-semibold">{headerText}</p>
            <p className="text-gray-400 text-xs">{subText}</p>
          </div>
        </div>
        <a
          href="https://audius.co"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
        >
          <span>🎧</span>
          <span className="font-medium">Audius</span>
        </a>
      </div>

      {/* Embed Player — iframe for the active track */}
      {activeTrackId && (
        <div className="px-4 pb-2">
          <div className="rounded-lg overflow-hidden border border-dark-600">
            <iframe
              src={`https://audius.co/embed/track/${activeTrackId}?flavor=card`}
              width="100%"
              height="120"
              allow="encrypted-media"
              style={{ border: "none" }}
              loading="lazy"
            />
          </div>
        </div>
      )}

      {/* Track List — additional tracks */}
      {tracks.length > 1 && (
        <div className="px-4 pb-2">
          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-medium mb-1.5">
            More tracks
          </p>
          <div className="space-y-1">
            {tracks.slice(1, 4).map((track) => (
              <button
                key={track.id}
                onClick={() => setActiveTrackId(track.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all ${
                  activeTrackId === track.id
                    ? "bg-purple-500/10 border border-purple-500/20"
                    : "bg-dark-700/50 hover:bg-dark-700 border border-transparent"
                }`}
              >
                {/* Artwork thumbnail */}
                {track.artwork ? (
                  <img
                    src={track.artwork}
                    alt={track.title}
                    className="w-8 h-8 rounded object-cover flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-dark-600 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs">♫</span>
                  </div>
                )}

                {/* Track info */}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-medium truncate">
                    {track.title}
                  </p>
                  <p className="text-gray-500 text-[10px] truncate">
                    {track.artistName}
                    {track.duration > 0 &&
                      ` · ${formatDuration(track.duration)}`}
                  </p>
                </div>

                {/* Play count */}
                <span className="text-gray-600 text-[10px] flex-shrink-0">
                  {track.playCount > 0 && `${formatPlayCount(track.playCount)} ▶`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Artist Coin / Profile Link */}
      {audiusProfileUrl && (
        <div className="px-4 pb-3">
          <a
            href={audiusProfileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-500/10 to-pink-500/10 
                       border border-purple-500/20 rounded-lg hover:from-purple-500/20 hover:to-pink-500/20 
                       transition-all group"
          >
            <span className="text-sm">🪙</span>
            <div className="flex-1">
              <p className="text-purple-300 text-xs font-medium group-hover:text-purple-200">
                Support {artist?.name || artistName} on Audius
              </p>
              <p className="text-gray-500 text-[10px]">
                Discover Artist Coins & exclusive content
              </p>
            </div>
            <span className="text-purple-400 text-xs">→</span>
          </a>
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 border-t border-dark-700 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-purple-500" />
          <span className="text-gray-500 text-[10px]">
            Open Audio Protocol
          </span>
        </div>
        <a
          href="https://audius.co"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-gray-400 text-[10px] transition-colors"
        >
          audius.co
        </a>
      </div>
    </div>
  );
}