"use client";

import { useState, useEffect } from "react";
import { ChatWindow } from "./components/ChatWindow";
import { ToolCallPanel } from "./components/ToolCallPanel";
import { Header } from "./components/Header";
import { PhantomGate } from "./components/PhantomGate";
import { usePhantom, WalletAction, PendingBooking } from "@/hooks/usePhantom";

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

  // Phantom wallet state
  const {
    connected,
    publicKey,
    phantomInstalled,
    connect,
    payPlatformFee,
    signMessage,
    sendSol,
    PLATFORM_FEE_SOL,
  } = usePhantom();

  const [accessPaid, setAccessPaid] = useState(false);
  const [platformTxHash, setPlatformTxHash] = useState<string | null>(null);

  // Handle platform fee payment
  const handlePlatformPay = async (): Promise<string | null> => {
    try {
      const sig = await payPlatformFee();
      if (sig) {
        setPlatformTxHash(sig);
        setAccessPaid(true);

        // Add system message about successful payment
        const paymentMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `✅ **Wallet connected & platform fee paid!**\n\nWelcome aboard! Your wallet \`${publicKey?.slice(0, 6)}...${publicKey?.slice(-4)}\` is connected.\n\n🔗 [View payment on Explorer](https://explorer.solana.com/tx/${sig}?cluster=devnet)\n\nYou can now search events, book tickets, and get email confirmations. What would you like to do?`,
          timestamp: new Date(),
          toolCalls: [
            {
              tool: "phantom_wallet",
              status: "completed",
              summary: `Platform fee ${PLATFORM_FEE_SOL} SOL paid successfully`,
            },
          ],
        };
        setMessages((prev) => [...prev, paymentMsg]);

        return sig;
      }
      return null;
    } catch (err) {
      throw err;
    }
  };

  // Handle wallet actions from agent (sign message or send SOL)
  const handleWalletAction = async (
    walletAction: WalletAction,
    pendingBooking: PendingBooking
  ) => {
    try {
      let txHash: string | null = null;
      let signature: string | null = null;

      if (walletAction.type === "sign_message" && walletAction.message) {
        // Free ticket: sign confirmation message
        setIsLoading(true);
        signature = await signMessage(walletAction.message);
        if (!signature) throw new Error("Signature cancelled");
      } else if (
        walletAction.type === "transfer_sol" &&
        walletAction.amount &&
        walletAction.recipient
      ) {
        // Paid ticket: send SOL
        setIsLoading(true);
        txHash = await sendSol(walletAction.amount, walletAction.recipient);
        if (!txHash) throw new Error("Transaction cancelled");
      }

      // Execute the booking on server
      const response = await fetch("/api/agent/execute-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: pendingBooking.event,
          attendees: pendingBooking.attendees,
          userWallet: publicKey,
          paymentTxHash: txHash,
          walletSignature: signature,
        }),
      });

      const data = await response.json();

      const bookingMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
        toolCalls: data.toolCalls,
        tickets: data.tickets,
      };
      setMessages((prev) => [...prev, bookingMsg]);
    } catch (err: any) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `❌ Wallet action failed: ${err.message || "Transaction was rejected."}\n\nPlease try booking again.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  // Send message to agent
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
          userWallet: publicKey, // Send connected wallet address
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

      // Check if agent wants a wallet action (booking confirmation)
      if (data.walletAction && data.pendingBooking) {
        // Show the agent's message first
        const promptMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.response,
          timestamp: new Date(),
          toolCalls: data.toolCalls,
        };
        setMessages((prev) => [...prev, promptMsg]);
        setIsLoading(false);
        setActiveToolCalls([]);

        // Trigger wallet action (Phantom popup)
        await handleWalletAction(data.walletAction, data.pendingBooking);
        return;
      }

      // Normal response (no wallet action needed)
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

          {/* Phantom Gate OR Input Area */}
          {!accessPaid ? (
            <PhantomGate
              phantomInstalled={phantomInstalled}
              connected={connected}
              publicKey={publicKey}
              onConnect={connect}
              onPay={handlePlatformPay}
              platformFee={PLATFORM_FEE_SOL}
            />
          ) : (
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
              <div className="max-w-3xl mx-auto flex items-center justify-between mt-2">
                <p className="text-xs text-gray-600">
                  Powered by Solana devnet • cNFT tickets via Metaplex
                  Bubblegum • Built for KYD Labs
                </p>
                {publicKey && (
                  <p className="text-xs text-gray-500">
                    🟢{" "}
                    <span className="font-mono">
                      {publicKey.slice(0, 4)}...{publicKey.slice(-4)}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tool Calls Sidebar (visible when agent is working) */}
        {activeToolCalls.length > 0 && (
          <ToolCallPanel toolCalls={activeToolCalls} />
        )}
      </div>
    </div>
  );
}