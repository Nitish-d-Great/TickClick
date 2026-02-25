// =============================================
// TixAgent — Header Component
// Shows branding + Solana Devnet badge + Calendar + GitHub
// =============================================

"use client";

interface HeaderProps {
  calendarConnected?: boolean;
  calendarEmail?: string | null;
  onCalendarConnect?: () => void;
}

export function Header({
  calendarConnected = false,
  calendarEmail = null,
  onCalendarConnect,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-dark-600 bg-dark-800/50 backdrop-blur-sm">
      {/* Left: Branding */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
          <span className="text-primary text-lg">🎫</span>
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">
            Tix<span className="text-primary">Agent</span>
          </h1>
          <p className="text-xs text-gray-500">AI Ticket Concierge</p>
        </div>
      </div>

      {/* Right: Status badges */}
      <div className="flex items-center gap-3">
        {/* Google Calendar Button */}
        {onCalendarConnect && (
          calendarConnected ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30">
              <span className="text-xs">📅</span>
              <span className="text-xs text-green-400 font-medium">
                {calendarEmail ? calendarEmail.split("@")[0] : "Calendar"}
              </span>
            </div>
          ) : (
            <button
              onClick={onCalendarConnect}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-dark-700 border border-dark-500 
                       hover:border-primary/50 hover:bg-dark-600 transition-all cursor-pointer"
              title="Connect Google Calendar for availability checking"
            >
              <span className="text-xs">📅</span>
              <span className="text-xs text-gray-400 font-medium">
                Connect Calendar
              </span>
            </button>
          )
        )}

        {/* Solana Devnet Badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-dark-700 border border-dark-600">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-gray-400 font-medium">
            Solana Devnet
          </span>
        </div>

        {/* GitHub Link */}
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}