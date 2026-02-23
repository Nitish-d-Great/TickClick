# 🎫 TixAgent — AI-Powered Ticket Concierge on Solana

> **An AI agent that discovers, coordinates, and books on-chain tickets for fans — so they never have to browse a ticketing website again.**

Built for the **Solana Graveyard Hackathon** (Feb 12–27, 2026) — **KYD Labs Ticketing Track** ($5,000 bounty)

---

## 🎯 Problem

Today's ticketing is broken:

1. **Fragmented** — Fans check Ticketmaster, StubHub, SeatGeek, venue sites. 45 minutes later, still unsure.
2. **No instant ownership** — You pay, but the seller has to "release" the ticket. Days pass.
3. **Coordination hell** — Syncing calendars with friends is manual and painful.
4. **Bots are the enemy** — Scalper bots exploit this broken system.

**KYD Labs' reframe:** What if bots weren't the enemy? What if every fan had their own AI agent?

## 💡 Solution

TixAgent is a conversational AI that handles the entire ticketing experience:

```
You: "Book 2 tickets for me and Akash. Check our calendars. 
      Under $50, prefer weekends, we like jazz."

TixAgent: 
  🧠 Parsing your request...
  🔍 Scanning Le Poisson Rouge and DJ Mike Nasty...
  📅 Checking calendars for you and Akash...
  🎯 Found 3 matching events!
  
  1. Jazz at LPR — Saturday, Mar 1 — $25 ✅ Both free
  2. DJ Mike Nasty Live — Saturday, Feb 28 — FREE ✅ Both free
  
  Which one? → "Book #1"
  
  ⚡ Payment sent (0.0025 SOL) → Tx: solana.fm/tx/...
  🎫 2 cNFT tickets minted → Asset: DAS/...
  ✅ Done! Tickets in your wallet.
```

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    NEXT.JS FRONTEND                       │
│              Chat UI + Wallet Connection                  │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                    AI AGENT LAYER                         │
│           LLM (GPT-4) + Tool Orchestration               │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Discover  │  │ Calendar │  │  Match   │  │  Book    │ │
│  │ Events    │  │  Check   │  │  Events  │  │ Tickets  │ │
│  └─────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
└────────┼────────────┼────────────┼────────────┼──────────┘
         │            │            │            │
    ┌────▼────┐  ┌────▼────┐      │     ┌──────▼──────┐
    │ KYD     │  │ Google  │      │     │   SOLANA    │
    │ Venues  │  │ Calendar│      │     │   DEVNET    │
    │ Scraper │  │  API    │      │     │             │
    └─────────┘  └─────────┘      │     │ ┌─────────┐ │
                                  │     │ │ SOL Pay  │ │
         lpr.kydlabs.com          │     │ │ cNFT     │ │
         djmikenasty.kydlabs.com  │     │ │ Mint     │ │
                                        │ │ Ticket   │ │
                                        │ │ Manager  │ │
                                        │ └─────────┘ │
                                        └─────────────┘
```

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14, Tailwind CSS | Chat interface |
| AI Agent | Google Gemini 2.0 Flash, LangChain | Intent parsing, orchestration |
| Scraping | Puppeteer | Real event data from KYD venues |
| Calendar | Google Calendar API | Multi-attendee availability |
| Blockchain | Solana devnet, @solana/web3.js | Payments, on-chain state |
| cNFT | Metaplex Bubblegum | Compressed NFT ticket minting |
| Smart Contract | Anchor (Rust) | Atomic purchase + redemption |

## 📂 Project Structure

```
tix-agent/
├── app/                          # Next.js frontend
│   ├── page.tsx                  # Main chat interface
│   ├── components/
│   │   ├── ChatWindow.tsx        # Message display
│   │   ├── TicketCard.tsx        # cNFT ticket display
│   │   ├── ToolCallPanel.tsx     # Agent activity sidebar
│   │   └── Header.tsx            # App header
│   └── api/agent/route.ts        # Chat API endpoint
├── agent/                        # AI agent logic
│   ├── index.ts                  # Agent orchestrator
│   ├── tools/
│   │   ├── scrapeEvents.ts       # KYD venue scraper
│   │   ├── checkCalendar.ts      # Google Calendar integration
│   │   ├── matchEvents.ts        # Event matching & ranking
│   │   └── executeBooking.ts     # Payment + cNFT minting
│   └── prompts/system.ts         # Agent system prompt
├── lib/solana.ts                 # Solana utilities
├── programs/ticket-manager/      # Anchor smart contract
│   └── src/lib.rs                # TicketManager program
├── scripts/                      # Setup scripts
│   ├── setup-wallets.ts          # Generate devnet wallets
│   └── create-merkle-tree.ts     # Create Bubblegum Merkle tree
└── types/index.ts                # TypeScript types
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Rust + Solana CLI + Anchor (for smart contract)
- Gemini API key

### 1. Install

```bash
git clone https://github.com/your-username/tix-agent.git
cd tix-agent
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Add your Gemini_API_KEY to .env
```

### 3. Setup Wallets (Solana Devnet)

```bash
npx ts-node scripts/setup-wallets.ts
# Copy the output keys to your .env file
```

### 4. Create Merkle Tree

```bash
npx ts-node scripts/create-merkle-tree.ts
# Copy MERKLE_TREE_ADDRESS to your .env file
```

### 5. Deploy Smart Contract (optional)

```bash
cd programs/ticket-manager
anchor build
anchor deploy --provider.cluster devnet
# Copy program ID to .env and Anchor.toml
```

### 6. Run

```bash
npm run dev
# Open http://localhost:3000
```

### 7. Try it!

Type in the chat:
> "Find me free events this weekend"

or

> "Book 2 tickets for me (Aman) and my friend (Akash). Under $50, prefer Saturday, we like jazz."

## ⛓️ On-Chain Components

### Compressed NFT Tickets (cNFTs)
- Minted via **Metaplex Bubblegum** on Solana devnet
- Each ticket contains: event name, date, venue, attendee, price, status
- Cost: ~$0.0001 per ticket (vs ~$2-3 for regular NFTs)

### TicketManager Smart Contract
Anchor program with 3 instructions:
- `purchase_ticket` — Atomic SOL transfer + ticket PDA creation
- `redeem_ticket` — Venue marks ticket as used (prevents reuse)
- `get_ticket_info` — Read on-chain ticket status

### Payment Flow
- Free events: Direct cNFT mint (no payment)
- Paid events: SOL transfer (proportional to USD price) + cNFT mint

## 📱 Demo

### Two-Tier Demo Flow
| Tier | Source | Price | Payment | Minting |
|------|--------|-------|---------|---------|
| Free events | djmikenasty.kydlabs.com | $0 | Skipped | Real cNFT on devnet |
| Paid events | lpr.kydlabs.com | $20-100+ | Simulated SOL on devnet | Real cNFT on devnet |

## 🏆 KYD Labs Track Qualification

This project directly answers KYD Labs' hackathon challenge:

> "What if bots weren't the enemy of ticketing? What if instead every fan had their own agent working for them? How would an agent discover, purchase, or coordinate tickets for a fan?"

| KYD's Ask | TixAgent |
|-----------|----------|
| AI agent for fans | ✅ Full conversational agent |
| Discover events | ✅ Real data from KYD venues |
| Purchase tickets | ✅ SOL payment + cNFT mint on Solana |
| Coordinate bookings | ✅ Google Calendar integration |
| Use cNFTs | ✅ Metaplex Bubblegum (per founder's guidance) |
| Real-world user flow | ✅ Natural language → on-chain ticket |

## 👥 Team

- Built for the Solana Graveyard Hackathon (Feb 2026)

## 📄 License

MIT
