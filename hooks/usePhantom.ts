// =============================================
// TickClick — Phantom Wallet Hook
// Connect, sign messages, send transactions
// =============================================

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const DEVNET_RPC = "https://api.devnet.solana.com";
const AGENT_WALLET = "8oSq8L9spHz4uXinL1wYDs8qFJDkeryK479N5DJvw6mx";
const PLATFORM_FEE_SOL = 0.001;

interface PhantomProvider {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array, encoding: string) => Promise<{ signature: Uint8Array }>;
  signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
  publicKey: PublicKey | null;
  isConnected: boolean;
  on: (event: string, callback: (...args: any[]) => void) => void;
  off: (event: string, callback: (...args: any[]) => void) => void;
}

function getProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const phantom = (window as any).phantom?.solana || (window as any).solana;
  if (phantom?.isPhantom) return phantom as PhantomProvider;
  return null;
}

export interface WalletAction {
  type: "sign_message" | "transfer_sol";
  message?: string;
  amount?: number;
  recipient?: string;
  description?: string;
}

export interface PendingBooking {
  event: any;
  attendees: any[];
}

export function usePhantom() {
  const [provider, setProvider] = useState<PhantomProvider | null>(null);
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [phantomInstalled, setPhantomInstalled] = useState(false);

  // Detect Phantom on mount
  useEffect(() => {
    const checkPhantom = () => {
      const p = getProvider();
      if (p) {
        setProvider(p);
        setPhantomInstalled(true);
        if (p.isConnected && p.publicKey) {
          setConnected(true);
          setPublicKey(p.publicKey.toString());
        }
      }
    };

    // Phantom may inject after page load
    if (typeof window !== "undefined") {
      if ((window as any).phantom?.solana) {
        checkPhantom();
      } else {
        window.addEventListener("load", checkPhantom);
        // Also try after a delay
        setTimeout(checkPhantom, 500);
        return () => window.removeEventListener("load", checkPhantom);
      }
    }
  }, []);

  // Connect wallet
  const connect = useCallback(async (): Promise<string | null> => {
    const p = getProvider();
    if (!p) {
      window.open("https://phantom.app/", "_blank");
      return null;
    }

    try {
      const resp = await p.connect();
      const addr = resp.publicKey.toString();
      setProvider(p);
      setConnected(true);
      setPublicKey(addr);
      return addr;
    } catch (err) {
      console.error("Phantom connect error:", err);
      return null;
    }
  }, []);

  // Disconnect
  const disconnect = useCallback(async () => {
    if (provider) {
      await provider.disconnect();
      setConnected(false);
      setPublicKey(null);
    }
  }, [provider]);

  // Pay platform access fee (0.001 SOL → agent wallet)
  const payPlatformFee = useCallback(async (): Promise<string | null> => {
    const p = getProvider();
    if (!p || !p.publicKey) return null;

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: p.publicKey,
          toPubkey: new PublicKey(AGENT_WALLET),
          lamports: Math.round(PLATFORM_FEE_SOL * LAMPORTS_PER_SOL),
        })
      );

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = p.publicKey;

      const { signature } = await p.signAndSendTransaction(transaction);

      // Wait for confirmation
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      console.log(`✅ Platform fee paid: ${signature}`);
      return signature;
    } catch (err: any) {
      console.error("Platform fee payment failed:", err);
      throw err;
    }
  }, []);

  // Sign a message (for free ticket booking confirmation)
  const signMessage = useCallback(
    async (message: string): Promise<string | null> => {
      const p = getProvider();
      if (!p || !p.publicKey) return null;

      try {
        const encodedMessage = new TextEncoder().encode(message);
        const { signature } = await p.signMessage(encodedMessage, "utf8");

        // Convert Uint8Array to hex string
        const sigHex = Array.from(signature)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        console.log(`✅ Message signed: ${sigHex.slice(0, 20)}...`);
        return sigHex;
      } catch (err: any) {
        console.error("Message signing failed:", err);
        throw err;
      }
    },
    []
  );

  // Send SOL (for paid ticket booking)
  const sendSol = useCallback(
    async (amount: number, recipient: string): Promise<string | null> => {
      const p = getProvider();
      if (!p || !p.publicKey) return null;

      try {
        const connection = new Connection(DEVNET_RPC, "confirmed");

        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: p.publicKey,
            toPubkey: new PublicKey(recipient),
            lamports: Math.round(amount * LAMPORTS_PER_SOL),
          })
        );

        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = p.publicKey;

        const { signature } = await p.signAndSendTransaction(transaction);

        await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed"
        );

        console.log(`✅ SOL sent (${amount} SOL): ${signature}`);
        return signature;
      } catch (err: any) {
        console.error("SOL transfer failed:", err);
        throw err;
      }
    },
    []
  );

  return {
    connected,
    publicKey,
    phantomInstalled,
    connect,
    disconnect,
    payPlatformFee,
    signMessage,
    sendSol,
    PLATFORM_FEE_SOL,
    AGENT_WALLET,
  };
}