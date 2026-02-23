"use client";

export function Header() {
  return (
    <header className="border-b border-dark-600 px-6 py-3 flex items-center justify-between bg-dark-800/80 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
          <span className="text-dark-900 font-bold text-sm">🎫</span>
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">
            Tix<span className="text-primary">Agent</span>
          </h1>
          <p className="text-xs text-gray-500">AI Ticket Concierge</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
          <span className="text-gray-400">Solana Devnet</span>
        </div>
        <a
          href="https://github.com/your-username/tix-agent"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-white text-sm transition-colors"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
