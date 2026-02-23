"use client";

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
}

interface TicketCardProps {
  ticket: Ticket;
}

export function TicketCard({ ticket }: TicketCardProps) {
  return (
    <div className="bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900 border border-primary/20 rounded-xl p-4 relative overflow-hidden">
      {/* Decorative gradient */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full -translate-y-12 translate-x-12" />
      <div className="absolute bottom-0 left-0 w-16 h-16 bg-secondary/5 rounded-full translate-y-8 -translate-x-8" />

      {/* Header */}
      <div className="flex items-start justify-between mb-3 relative">
        <div>
          <p className="text-xs text-primary font-medium uppercase tracking-wider">
            cNFT Ticket
          </p>
          <h4 className="text-white font-semibold text-sm mt-0.5">
            {ticket.eventName}
          </h4>
        </div>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            ticket.status === "Active"
              ? "bg-green-900/30 text-green-400 border border-green-800/30"
              : "bg-gray-800 text-gray-400 border border-gray-700"
          }`}
        >
          {ticket.status}
        </span>
      </div>

      {/* Details */}
      <div className="space-y-1.5 text-xs relative">
        <div className="flex justify-between">
          <span className="text-gray-500">Attendee</span>
          <span className="text-white font-medium">{ticket.attendeeName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Venue</span>
          <span className="text-gray-300">{ticket.venue}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Date</span>
          <span className="text-gray-300">{ticket.eventDate}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Price</span>
          <span className="text-gray-300">
            {ticket.pricePaid === 0 ? "FREE" : `$${ticket.pricePaid}`}
          </span>
        </div>
      </div>

      {/* Asset ID */}
      <div className="mt-3 pt-3 border-t border-dark-600">
        <p className="text-[10px] text-gray-500 mb-1">Asset ID</p>
        <p className="text-[10px] text-gray-400 font-mono break-all">
          {ticket.cnftAssetId}
        </p>
      </div>

      {/* Explorer Link */}
      <a
        href={ticket.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex items-center justify-center gap-2 bg-primary/10 hover:bg-primary/20 
                 border border-primary/20 rounded-lg py-2 text-xs text-primary font-medium 
                 transition-all"
      >
        <span>View on Solana Explorer</span>
        <span>↗</span>
      </a>
    </div>
  );
}
