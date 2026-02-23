"use client";

interface ToolCall {
  tool: string;
  status: "running" | "completed" | "error";
  summary: string;
}

interface ToolCallPanelProps {
  toolCalls: ToolCall[];
}

const TOOL_ICONS: Record<string, string> = {
  parse_intent: "🧠",
  discover_events: "🔍",
  check_calendars: "📅",
  match_events: "🎯",
  execute_booking: "⚡",
};

const TOOL_LABELS: Record<string, string> = {
  parse_intent: "Parsing Intent",
  discover_events: "Discovering Events",
  check_calendars: "Checking Calendars",
  match_events: "Matching Events",
  execute_booking: "Executing Booking",
};

export function ToolCallPanel({ toolCalls }: ToolCallPanelProps) {
  return (
    <div className="w-72 border-l border-dark-600 bg-dark-800 p-4 overflow-y-auto">
      <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
        <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
        Agent Working...
      </h3>

      <div className="space-y-3">
        {toolCalls.map((tc, index) => (
          <div
            key={index}
            className={`p-3 rounded-lg border ${
              tc.status === "running"
                ? "border-primary/30 bg-primary/5 tool-running"
                : tc.status === "completed"
                ? "border-green-800/30 bg-green-900/10"
                : "border-red-800/30 bg-red-900/10"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">
                {TOOL_ICONS[tc.tool] || "⚙️"}
              </span>
              <span className="text-xs font-medium text-gray-300">
                {TOOL_LABELS[tc.tool] || tc.tool}
              </span>
              <span className="ml-auto">
                {tc.status === "running" && (
                  <span className="text-xs text-primary">⏳</span>
                )}
                {tc.status === "completed" && (
                  <span className="text-xs text-green-400">✅</span>
                )}
                {tc.status === "error" && (
                  <span className="text-xs text-red-400">❌</span>
                )}
              </span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              {tc.summary}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 p-3 bg-dark-700 rounded-lg">
        <p className="text-[10px] text-gray-500 leading-relaxed">
          TixAgent is scanning KYD-powered venues, checking availability,
          and preparing on-chain tickets on Solana devnet.
        </p>
      </div>
    </div>
  );
}
