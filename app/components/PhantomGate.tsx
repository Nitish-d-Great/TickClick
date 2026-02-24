// =============================================
// TickClick — Phantom Wallet Access Gate
// Connect wallet + pay 0.001 SOL to unlock chat
// Replaces the input area until payment is made
// =============================================

"use client";

import { useState } from "react";

interface PhantomGateProps {
  phantomInstalled: boolean;
  connected: boolean;
  publicKey: string | null;
  onConnect: () => Promise<string | null>;
  onPay: () => Promise<string | null>;
  platformFee: number;
}

export function PhantomGate({
  phantomInstalled,
  connected,
  publicKey,
  onConnect,
  onPay,
  platformFee,
}: PhantomGateProps) {
  const [connecting, setConnecting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const addr = await onConnect();
      if (!addr) {
        setError("Connection cancelled or Phantom not found.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  };

  const handlePay = async () => {
    setPaying(true);
    setError(null);
    try {
      const sig = await onPay();
      if (sig) {
        setTxHash(sig);
      } else {
        setError("Payment cancelled.");
      }
    } catch (err: any) {
      if (err.message?.includes("User rejected")) {
        setError("Transaction rejected. Please try again.");
      } else if (err.message?.includes("insufficient")) {
        setError(
          "Insufficient SOL balance. Get devnet SOL from faucet.solana.com"
        );
      } else {
        setError(err.message || "Payment failed");
      }
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="border-t border-dark-600 p-4">
      <div className="max-w-3xl mx-auto">
        {/* Gate Card */}
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6 text-center">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-3 mb-5">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                connected
                  ? "bg-primary text-dark-900"
                  : "bg-dark-600 text-gray-400"
              }`}
            >
              {connected ? "✓" : "1"}
            </div>
            <div className="w-12 h-0.5 bg-dark-600">
              <div
                className={`h-full transition-all duration-500 ${
                  connected ? "bg-primary w-full" : "w-0"
                }`}
              />
            </div>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                txHash
                  ? "bg-primary text-dark-900"
                  : connected
                  ? "bg-dark-600 text-white"
                  : "bg-dark-600 text-gray-500"
              }`}
            >
              {txHash ? "✓" : "2"}
            </div>
          </div>

          {/* Not installed */}
          {!phantomInstalled && (
            <>
              <div className="text-2xl mb-3">👻</div>
              <h3 className="text-white font-semibold text-lg mb-2">
                Phantom Wallet Required
              </h3>
              <p className="text-gray-400 text-sm mb-4">
                Install Phantom to connect your Solana wallet and access
                TickClick.
              </p>
              <a
                href="https://phantom.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-[#AB9FF2] text-dark-900 font-semibold px-6 py-3 rounded-xl
                         hover:bg-[#AB9FF2]/80 transition-all"
              >
                Install Phantom →
              </a>
            </>
          )}

          {/* Step 1: Connect */}
          {phantomInstalled && !connected && (
            <>
              <div className="text-2xl mb-3">🔗</div>
              <h3 className="text-white font-semibold text-lg mb-2">
                Connect Your Wallet
              </h3>
              <p className="text-gray-400 text-sm mb-4">
                Connect your Phantom wallet to access the AI ticket agent.
              </p>
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="bg-[#AB9FF2] text-dark-900 font-semibold px-6 py-3 rounded-xl
                         hover:bg-[#AB9FF2]/80 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-all flex items-center gap-2 mx-auto"
              >
                {connecting ? (
                  <>
                    <span className="animate-spin">⏳</span> Connecting...
                  </>
                ) : (
                  <>👻 Connect Phantom</>
                )}
              </button>
            </>
          )}

          {/* Step 2: Pay */}
          {phantomInstalled && connected && !txHash && (
            <>
              <div className="text-2xl mb-3">⚡</div>
              <h3 className="text-white font-semibold text-lg mb-2">
                Pay Platform Access Fee
              </h3>
              <p className="text-gray-400 text-sm mb-2">
                One-time fee of{" "}
                <span className="text-primary font-semibold">
                  {platformFee} SOL
                </span>{" "}
                to access the TickClick AI agent.
              </p>
              <p className="text-gray-500 text-xs mb-4">
                Connected:{" "}
                <span className="text-gray-400 font-mono">
                  {publicKey?.slice(0, 6)}...{publicKey?.slice(-4)}
                </span>
              </p>
              <button
                onClick={handlePay}
                disabled={paying}
                className="bg-primary text-dark-900 font-semibold px-6 py-3 rounded-xl
                         hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-all flex items-center gap-2 mx-auto"
              >
                {paying ? (
                  <>
                    <span className="animate-spin">⏳</span> Confirming
                    transaction...
                  </>
                ) : (
                  <>💳 Pay {platformFee} SOL & Enter</>
                )}
              </button>
              <p className="text-gray-600 text-xs mt-3">
                Solana Devnet • Transaction verifiable on Explorer
              </p>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-2">
          Powered by Solana devnet • cNFT tickets via Metaplex Bubblegum •
          Built for KYD Labs
        </p>
      </div>
    </div>
  );
}