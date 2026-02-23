"use client";

import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { TicketCard } from "./TicketCard";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolCalls?: any[];
  tickets?: any[];
  events?: any[];
}

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
}

export function ChatWindow({ messages, isLoading }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-5 py-3 ${
                msg.role === "user"
                  ? "bg-primary/15 border border-primary/20 text-white"
                  : "bg-dark-700 border border-dark-600 text-gray-200"
              }`}
            >
              {/* Agent icon */}
              {msg.role === "assistant" && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-primary">
                    🎫 TixAgent
                  </span>
                </div>
              )}

              {/* Message content */}
              <div className="chat-markdown text-sm leading-relaxed">
                <ReactMarkdown
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-secondary hover:text-secondary/80 underline"
                      >
                        {children}
                      </a>
                    ),
                    code: ({ children }) => (
                      <code className="bg-dark-900 text-primary/80 px-1.5 py-0.5 rounded text-xs">
                        {children}
                      </code>
                    ),
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>

              {/* Tool calls summary */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mt-3 pt-3 border-t border-dark-600">
                  <p className="text-xs text-gray-500 mb-2">Agent Actions:</p>
                  <div className="space-y-1">
                    {msg.toolCalls.map((tc: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs text-gray-400"
                      >
                        <span>
                          {tc.status === "completed" ? "✅" : tc.status === "error" ? "❌" : "⏳"}
                        </span>
                        <span>{tc.summary}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ticket cards */}
              {msg.tickets && msg.tickets.length > 0 && (
                <div className="mt-4 space-y-3">
                  {msg.tickets.map((ticket: any, i: number) => (
                    <TicketCard key={i} ticket={ticket} />
                  ))}
                </div>
              )}

              {/* Timestamp */}
              <div className="mt-2 text-right">
              <span suppressHydrationWarning>
  {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
</span>
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-dark-700 border border-dark-600 rounded-2xl px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-primary">🎫 TixAgent</span>
                <div className="flex gap-1 ml-2">
                  <div className="typing-dot w-2 h-2 bg-primary/60 rounded-full" />
                  <div className="typing-dot w-2 h-2 bg-primary/60 rounded-full" />
                  <div className="typing-dot w-2 h-2 bg-primary/60 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
