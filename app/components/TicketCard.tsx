"use client";

import { useState } from "react";

interface Ticket {
  attendeeName: string;
  cnftAssetId: string;
  mintTxHash: string;
  eventName: string;
  eventDate: string;
  venue: string;
  pricePaid: number;
  status: string;
  explorerUrl: string;
  metadataUri?: string;
  eventImage?: string;
}

interface TicketCardProps {
  ticket: Ticket;
}

// Venue-specific fallback images
function getEventImage(ticket: Ticket): string {
  if (ticket.eventImage) return ticket.eventImage;
  const v = (ticket.venue || "").toLowerCase();
  if (v.includes("poisson rouge") || v.includes("lpr"))
    return "https://images.unsplash.com/photo-1501386761578-0a55d8f28b23?w=600&q=80";
  if (v.includes("mike nasty") || v.includes("djmikenasty"))
    return "https://images.unsplash.com/photo-1571266028243-3716f02d2d58?w=600&q=80";
  return "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=600&q=80";
}

export function TicketCard({ ticket }: TicketCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const isReal = !ticket.cnftAssetId.startsWith("DemoAsset");
  const eventImage = getEventImage(ticket);

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden max-w-sm w-full shadow-xl shadow-black/20">
      {/* ── Event Poster Image ── */}
      <div className="relative w-full h-44 bg-dark-700 overflow-hidden">
        {!imageError ? (
          <>
            {/* Shimmer placeholder while loading */}
            {!imageLoaded && (
              <div className="absolute inset-0 bg-gradient-to-r from-dark-700 via-dark-600 to-dark-700 animate-pulse" />
            )}
            <img
              src={eventImage}
              alt={ticket.eventName}
              className={`w-full h-full object-cover transition-opacity duration-500 ${
                imageLoaded ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </>
        ) : (
          /* Fallback gradient if image fails */
          <div className="w-full h-full bg-gradient-to-br from-purple-900/60 via-dark-800 to-cyan-900/40 flex items-center justify-center">
            <span className="text-4xl">🎫</span>
          </div>
        )}

        {/* Overlay gradient for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-dark-900/90 via-dark-900/30 to-transparent" />

        {/* Status badge */}
        <div className="absolute top-3 right-3">
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full backdrop-blur-sm ${
              ticket.status === "Active"
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "bg-gray-500/20 text-gray-400 border border-gray-500/30"
            }`}
          >
            {isReal ? "On-Chain" : "Demo"}
          </span>
        </div>

        {/* cNFT badge */}
        <div className="absolute top-3 left-3">
          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/20 text-primary border border-primary/30 backdrop-blur-sm">
            cNFT Ticket
          </span>
        </div>

        {/* Event name overlay on image */}
        <div className="absolute bottom-3 left-4 right-4">
          <h4 className="text-white font-bold text-base leading-tight drop-shadow-lg">
            {ticket.eventName.replace(/\s*\(Sold Out\)/gi, "")}
          </h4>
        </div>
      </div>

      {/* ── Ticket Details ── */}
      <div className="p-4 space-y-3">
        {/* Attendee & Venue row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">
              Attendee
            </p>
            <p className="text-sm text-white font-semibold">
              {ticket.attendeeName}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">
              Venue
            </p>
            <p className="text-sm text-gray-300 truncate">{ticket.venue}</p>
          </div>
        </div>

        {/* Date & Price row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">
              Date
            </p>
            <p className="text-sm text-gray-300">{ticket.eventDate}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">
              Price
            </p>
            <p className="text-sm text-white font-semibold">
              {ticket.pricePaid === 0 ? (
                <span className="text-green-400">FREE</span>
              ) : (
                `$${ticket.pricePaid}`
              )}
            </p>
          </div>
        </div>

        {/* Divider with perforation effect */}
        <div className="relative py-1">
          <div className="border-t border-dashed border-dark-600" />
          <div className="absolute -left-6 top-1/2 -translate-y-1/2 w-4 h-4 bg-dark-900 rounded-full" />
          <div className="absolute -right-6 top-1/2 -translate-y-1/2 w-4 h-4 bg-dark-900 rounded-full" />
        </div>

        {/* On-chain details */}
        {isReal && (
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">
                Mint Transaction
              </p>
              <p className="text-[11px] text-gray-400 font-mono break-all leading-relaxed">
                {ticket.mintTxHash}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">
                Asset ID
              </p>
              <p className="text-[11px] text-gray-400 font-mono break-all">
                {ticket.cnftAssetId}
              </p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <a
            href={ticket.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 bg-primary/10 hover:bg-primary/20 
                     border border-primary/20 hover:border-primary/40 rounded-lg py-2.5 
                     text-xs text-primary font-semibold transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Verify on Solana
          </a>
          {ticket.metadataUri && (
            <a
              href={ticket.metadataUri}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 bg-dark-700 hover:bg-dark-600 
                       border border-dark-500 hover:border-dark-400 rounded-lg px-3 py-2.5 
                       text-xs text-gray-400 hover:text-gray-300 font-medium transition-all"
              title="View NFT Metadata"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              JSON
            </a>
          )}
        </div>

        {/* Solana + TickClick branding */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195]" />
            <span className="text-[10px] text-gray-500 font-medium">
              Solana Devnet
            </span>
          </div>
          <span className="text-[10px] text-gray-600 font-medium">
            TickClick × KYD Labs
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Container for rendering multiple ticket cards after a booking.
 * Drop this into ChatWindow where message.tickets exists.
 */
export function TicketCardGrid({ tickets }: { tickets: Ticket[] }) {
  if (!tickets || tickets.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-4">
      {tickets.map((ticket, i) => (
        <TicketCard key={`${ticket.cnftAssetId}-${i}`} ticket={ticket} />
      ))}
    </div>
  );
}