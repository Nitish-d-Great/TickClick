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
> "Book 2 tickets for me (abc@email.com) and my friend Akash (xyz@email.com). Check our calendars. Under $50, prefer weekends."

Or start simple:
> "What events are available this weekend?"`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeToolCalls, setActiveToolCalls] = useState<any[]>([]);

  // Store last booking result for email flow
  const [lastBookingResult, setLastBookingResult] = useState<any>(null);

  // Google Calendar state
  const [calendarToken, setCalendarToken] = useState<string | null>(null);
  const [calendarEmail, setCalendarEmail] = useState<string | null>(null);
  const [calendarExpires, setCalendarExpires] = useState<number | null>(null);
  const [attendeeEmails, setAttendeeEmails] = useState<string[]>([]);

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

  // Restore accessPaid + handle OAuth callback on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Restore accessPaid from sessionStorage (survives OAuth redirect)
    const paid = sessionStorage.getItem("tickclick_access_paid");
    if (paid === "true") {
      setAccessPaid(true);
    }

    // 2. Handle Google Calendar OAuth callback or errors
    const hash = window.location.hash;

    if (!hash.includes("calendar_token=")) {
      // Plain page load / refresh — check for calendar error in query params only
      const urlParams = new URLSearchParams(window.location.search);
      const calError = urlParams.get("calendar_error");
      if (calError) {
        const errorMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `❌ Google Calendar connection failed: ${calError}. You can try again or continue without calendar integration.`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        window.history.replaceState(null, "", window.location.pathname);
      }
      // Do NOT auto-connect calendar on refresh
      return;
    }

    // This is an OAuth callback — parse the token
    const params = new URLSearchParams(hash.replace("#", ""));
    const token = params.get("calendar_token");
    const email = params.get("calendar_email");
    const expires = params.get("calendar_expires");

    if (token) {
      setCalendarToken(token);
      setCalendarEmail(email ? decodeURIComponent(email) : null);
      setCalendarExpires(expires ? parseInt(expires) : null);

      // Add the primary user's email to attendee list
      if (email) {
        setAttendeeEmails((prev) => {
          const decoded = decodeURIComponent(email);
          return prev.includes(decoded) ? prev : [...prev, decoded];
        });
      }

      console.log(`[Calendar] Connected: ${email}`);

      // Clean up URL hash immediately so refresh won't re-trigger
      window.history.replaceState(null, "", window.location.pathname);

      // Show calendar connected message
      const calMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `📅 **Google Calendar connected!** (${email ? decodeURIComponent(email) : "connected"})\n\nI'll now check your calendar before booking to make sure you're free. If you're booking for others, include their email addresses so I can check their calendars too.\n\n*Example: "Book 2 tickets for me and akash@gmail.com for Emo Night Brooklyn"*`,
        timestamp: new Date(),
        toolCalls: [
          {
            tool: "google_calendar",
            status: "completed",
            summary: `Google Calendar connected: ${email ? decodeURIComponent(email) : "connected"}`,
          },
        ],
      };
      setMessages((prev) => [...prev, calMsg]);
    }
  }, []);

  // Check if calendar token is expired
  const isCalendarConnected =
    calendarToken !== null &&
    calendarExpires !== null &&
    Date.now() < calendarExpires;

  // Handle Google Calendar connect
  const handleCalendarConnect = () => {
    window.location.href = "/api/auth/google";
  };

  // Extract attendee emails from messages
  const extractEmailsFromMessage = (message: string): string[] => {
    const matches = message.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    );
    return matches || [];
  };

  // Handle platform fee payment
  const handlePlatformPay = async (): Promise<string | null> => {
    try {
      const sig = await payPlatformFee();
      if (sig) {
        setPlatformTxHash(sig);
        setAccessPaid(true);
        sessionStorage.setItem("tickclick_access_paid", "true"); // Persist across OAuth redirect

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
        setIsLoading(true);
        setActiveToolCalls((prev) => [...prev, { tool: "phantom_wallet", status: "running", summary: "Requesting message signature..." }]);
        signature = await signMessage(walletAction.message);
        if (!signature) throw new Error("Signature cancelled");
        setActiveToolCalls((prev) => prev.map((tc) => tc.tool === "phantom_wallet" ? { ...tc, status: "completed", summary: "Message signed ✓" } : tc));
      } else if (
        walletAction.type === "transfer_sol" &&
        walletAction.amount &&
        walletAction.recipient
      ) {
        setIsLoading(true);
        setActiveToolCalls((prev) => [...prev, { tool: "phantom_wallet", status: "running", summary: `Requesting ${walletAction.amount} SOL payment...` }]);
        txHash = await sendSol(walletAction.amount, walletAction.recipient);
        if (!txHash) throw new Error("Transaction cancelled");
        setActiveToolCalls((prev) => prev.map((tc) => tc.tool === "phantom_wallet" ? { ...tc, status: "completed", summary: `Payment of ${walletAction.amount} SOL confirmed ✓` } : tc));
      }

      setActiveToolCalls((prev) => [...prev, { tool: "mint_cnft", status: "running", summary: "Minting cNFT ticket on Solana..." }]);

      const response = await fetch("/api/agent/execute-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: pendingBooking.event,
          attendees: pendingBooking.attendees,
          userWallet: publicKey,
          paymentTxHash: txHash,
          walletSignature: signature,
          // Pass calendar data so post-booking event creation works
          calendarToken: (pendingBooking as any).calendarToken || (isCalendarConnected ? calendarToken : undefined),
          attendeeEmails: (pendingBooking as any).attendeeEmails || (isCalendarConnected ? attendeeEmails : undefined),
        }),
      });

      const bookingData = await response.json();

      // Update minting tool call status
      setActiveToolCalls((prev) =>
        prev.map((tc) =>
          tc.tool === "mint_cnft" ? { ...tc, status: "completed", summary: "cNFT ticket minted ✓" } : tc
        )
      );

      // ══════════════════════════════════════════════════════════════
      // Store booking result for email flow — with fallback construction
      // This is critical: without bookingResult, email confirmations fail
      // ══════════════════════════════════════════════════════════════
      if (bookingData.bookingResult) {
        setLastBookingResult(bookingData.bookingResult);
        console.log("[Client] Stored bookingResult from execute-booking response");
      } else if (bookingData.tickets && bookingData.tickets.length > 0) {
        // Fallback: construct bookingResult from available data
        // Handles case where execute-booking route doesn't return bookingResult,
        // or server state was lost between minting and response
        const fallbackResult = {
          success: true,
          tickets: bookingData.tickets,
          event: pendingBooking.event,
          attendees: pendingBooking.attendees,
          totalPrice: (pendingBooking.event.price || 0) * pendingBooking.attendees.length,
          solAmount: ((pendingBooking.event.price || 0) * pendingBooking.attendees.length) / 10000,
        };
        setLastBookingResult(fallbackResult);
        console.log("[Client] Constructed fallback bookingResult from tickets data");
      } else {
        console.warn("[Client] ⚠️ No bookingResult AND no tickets in execute-booking response — email flow will fail");
      }

      const bookingMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: bookingData.response,
        timestamp: new Date(),
        toolCalls: bookingData.toolCalls,
        tickets: bookingData.tickets,
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

    // Extract any emails from the message and add to attendee list
    const newEmails = extractEmailsFromMessage(input);
    if (newEmails.length > 0) {
      setAttendeeEmails((prev) => {
        const combined = Array.from(new Set([...prev, ...newEmails]));
        return combined;
      });
    }

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setActiveToolCalls([]);

    try {
      // Build current attendee emails including any new ones from this message
      const currentEmails = Array.from(new Set([...attendeeEmails, ...newEmails]));

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          history: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          userWallet: publicKey,
          bookingResult: lastBookingResult,
          calendarToken: isCalendarConnected ? calendarToken : undefined,
          attendeeEmails: isCalendarConnected ? currentEmails : undefined,
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

      // Store booking result if server returns one (non-wallet flow)
      if (data.bookingResult) {
        setLastBookingResult(data.bookingResult);
      }

      // Check if agent wants a wallet action (booking confirmation)
      if (data.walletAction && data.pendingBooking) {
        const promptMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.response,
          timestamp: new Date(),
          toolCalls: data.toolCalls,
        };
        setMessages((prev) => [...prev, promptMsg]);
        setIsLoading(false);

        await handleWalletAction(data.walletAction, data.pendingBooking);
        return;
      }

      // Normal response
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
    }
  };

  return (
    <div className="flex flex-col h-screen bg-dark-900">
      <Header
        calendarConnected={isCalendarConnected}
        calendarEmail={calendarEmail}
        onCalendarConnect={handleCalendarConnect}
        showCalendar={accessPaid}
      />

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
                <div className="flex items-center gap-3">
                  {isCalendarConnected && (
                    <p className="text-xs text-green-500">
                      📅 {calendarEmail?.split("@")[0]}
                    </p>
                  )}
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