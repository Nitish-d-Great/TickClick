"use client";

import { useState, useRef, useEffect } from "react";
import { ChatWindow } from "./components/ChatWindow";
import { ToolCallPanel } from "./components/ToolCallPanel";
import { Header } from "./components/Header";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolCalls?: any[];
  tickets?: any[];
  events?: any[];
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `Hey! 👋 I'm **TixAgent** — your AI concierge for live events.

Tell me what you're looking for and I'll find the perfect show, check everyone's calendars, and book on-chain tickets for you.

**Try saying something like:**
> "Book 2 tickets for me and my friend Akash. Check our calendars. Under $50, prefer weekends, we like jazz."

Or start simple:
> "What events are available this weekend?"`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeToolCalls, setActiveToolCalls] = useState<any[]>([]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setActiveToolCalls([]);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          history: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await response.json();

      // Animate tool calls
      if (data.toolCalls) {
        for (const tc of data.toolCalls) {
          setActiveToolCalls((prev) => [...prev, tc]);
          await new Promise((r) => setTimeout(r, 800));
        }
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
        toolCalls: data.toolCalls,
        tickets: data.tickets,
        events: data.events,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setActiveToolCalls([]);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-dark-900">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        {/* Main Chat Area */}
        <div className="flex flex-col flex-1">
          <ChatWindow messages={messages} isLoading={isLoading} />

          {/* Input Area */}
          <div className="border-t border-dark-600 p-4">
            <div className="max-w-3xl mx-auto flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Tell me what event you're looking for..."
                className="flex-1 bg-dark-700 border border-dark-600 rounded-xl px-4 py-3 
                         text-white placeholder-gray-500 focus:outline-none focus:border-primary/50
                         focus:ring-1 focus:ring-primary/30 transition-all"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="bg-primary text-dark-900 font-semibold px-6 py-3 rounded-xl
                         hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed
                         transition-all"
              >
                {isLoading ? "..." : "Send"}
              </button>
            </div>
            <p className="text-center text-xs text-gray-600 mt-2">
              Powered by Solana devnet • cNFT tickets via Metaplex Bubblegum • Built for KYD Labs
            </p>
          </div>
        </div>

        {/* Tool Calls Sidebar (visible when agent is working) */}
        {activeToolCalls.length > 0 && (
          <ToolCallPanel toolCalls={activeToolCalls} />
        )}
      </div>
    </div>
  );
}
