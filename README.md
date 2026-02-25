# 🎟️ TixAgent — AI-Powered Ticket Booking Agent

> **Solana Graveyard Hackathon × KYD Labs**
> An AI concierge that discovers live events, checks calendar availability, and books real on-chain compressed NFT (cNFT) tickets on Solana devnet.

---

## 🧠 What is TixAgent?

TixAgent is a conversational AI agent that handles the entire ticket booking lifecycle:

1. **Discover Events** — Scrapes real events from KYD Labs-powered venues (Le Poisson Rouge, DJ Mike Nasty) using Puppeteer, including live pricing from individual event pages.
2. **Understand Intent** — Parses natural language requests to extract attendees, budgets, date preferences, and genre interests.
3. **Check Calendars** — Integrates with Google Calendar via OAuth 2.0 + FreeBusy API to check attendee availability and flag scheduling conflicts.
4. **Match & Recommend** — Scores and ranks events based on user preferences, budget, and calendar availability.
5. **Mint On-Chain Tickets** — Mints real compressed NFTs (cNFTs) on Solana devnet via Metaplex Bubblegum, with each ticket owned by the user's Phantom wallet.
6. **Email Confirmations** — Sends booking confirmation emails via Resend with ticket details, transaction hashes, and Solana Explorer links.

---

## ✨ Key Features

### 🔐 Wallet-Gated Platform Access
Every user pays a **one-time 0.001 SOL platform fee** through Phantom before unlocking the AI agent. This micro-payment flows directly to the agent's on-chain wallet, creating a verifiable revenue trail on Solana — and ensures only committed users interact with the booking engine.

### ✍️ Cryptographic Booking Confirmation for Free Events
Free doesn't mean unsigned. When a user books a free event, TixAgent prompts a **Phantom message signature** — a cryptographic proof-of-intent that ties the booking to the user's wallet identity. No SOL leaves the wallet, but the signed message serves as an immutable, wallet-verified confirmation that the attendee genuinely requested the ticket.

### 💸 Real On-Chain Payments for Paid Events
Since the project runs on **Solana devnet**, TixAgent simulates real-world ticket economics using a deterministic pricing formula: **`ticket_price_usd / 10,000` SOL**. A $50 ticket costs 0.005 devnet SOL. The user approves a real SOL transfer through Phantom to the venue wallet — producing a fully verifiable payment transaction on Solana Explorer, identical to how a production deployment would work on mainnet.

### 📅 Book Tickets on Behalf of Anyone via Shared Calendars
TixAgent doesn't just book for the logged-in user — it can **check availability and book tickets for any group of people** whose Google Calendars are shared with the authenticated account. A team lead can book for their entire team, a friend can book for their group — as long as calendar access is shared, the agent handles conflict detection and multi-attendee booking seamlessly.

### 🧰 Live Agent Toolchain Visibility
Every action the AI agent takes — from scraping venues to checking calendars to minting cNFTs — is displayed in a **real-time sidebar** with animated status indicators. Users watch each tool spin up, execute, and complete, providing full transparency into the agent's decision-making pipeline. Nothing happens behind a black box.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js 14 Frontend                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  ChatWindow   │  │ PhantomGate  │  │ ToolCallPanel │ │
│  │  (Messages)   │  │ (Wallet UI)  │  │ (Live Status) │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────────┘ │
│         │                  │                             │
│         │    usePhantom Hook (Connect + Sign + Pay)      │
│         └──────────┬───────┘                             │
└────────────────────┼─────────────────────────────────────┘
                     │ POST /api/agent
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  AI Agent (Groq LLM)                    │
│  ┌─────────────┐ ┌────────────┐ ┌─────────────────────┐│
│  │  Classifier  │ │  Intent    │ │  Response Generator ││
│  │  (Action)    │ │  Extractor │ │  (Conversational)   ││
│  └──────┬──────┘ └─────┬──────┘ └─────────────────────┘│
│         │              │                                 │
│  ┌──────▼──────────────▼────────────────────────────┐   │
│  │              Agent Tools                          │   │
│  │  ┌───────────┐ ┌──────────┐ ┌─────────────────┐ │   │
│  │  │ Scraper   │ │ Calendar │ │ Event Matcher   │ │   │
│  │  │(Puppeteer)│ │(Google)  │ │(Score & Rank)   │ │   │
│  │  └───────────┘ └──────────┘ └─────────────────┘ │   │
│  │  ┌───────────────────┐ ┌───────────────────────┐│   │
│  │  │ Booking Executor  │ │ Email Sender (Resend) ││   │
│  │  │ (Solana cNFT Mint)│ │                       ││   │
│  │  └────────┬──────────┘ └───────────────────────┘│   │
│  └───────────┼──────────────────────────────────────┘   │
└──────────────┼──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│                 Solana Devnet                            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Merkle Tree  │  │  Bubblegum   │  │  User Wallet  │ │
│  │ (Compressed) │  │  (mintV1)    │  │  (Phantom)    │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## ⚡ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, Tailwind CSS |
| AI / LLM | Groq (Llama 3.3 70B Versatile) |
| Blockchain | Solana devnet, Metaplex Bubblegum (cNFTs), `@solana/web3.js` |
| Wallet | Phantom Browser Extension |
| Scraping | Puppeteer (headless Chrome) |
| Calendar | Google Calendar API (OAuth 2.0 + FreeBusy) |
| Email | Resend API |
| Language | TypeScript |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **Phantom Wallet** browser extension
- **Solana CLI** (for wallet setup & airdrops)

### 1. Clone & Install

```bash
git clone https://github.com/your-repo/tickclick.git
cd tickclick
npm install
```

### 2. Set Up Wallets

```bash
# Create venue wallet (tree authority + minter)
solana-keygen new --outfile wallets/venue-wallet.json

# Fund it on devnet
solana airdrop 2 $(solana-keygen pubkey wallets/venue-wallet.json) --url devnet

# Create Merkle tree for cNFT minting
npm run setup:merkle-tree
```

### 3. Configure Environment

Create `.env.local`:

```env
# LLM
GROQ_API_KEY=gsk_...

# Solana
MERKLE_TREE_ADDRESS=<your-merkle-tree-address>
VENUE_WALLET_KEYPAIR_PATH=./wallets/venue-wallet.json
VENUE_WALLET_PUBLIC_KEY=<your-venue-wallet-pubkey>
USER_WALLET_PUBLIC_KEY=<your-phantom-wallet-pubkey>
SOLANA_RPC_URL=https://api.devnet.solana.com

# Email
RESEND_API_KEY=re_...

# Google Calendar OAuth
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser with Phantom installed.

---

## 🎮 User Flow

### Step 1 — Connect Wallet & Pay Platform Fee

The user connects their Phantom wallet and pays a one-time **0.001 SOL** platform access fee. The chat interface unlocks after payment is confirmed on-chain.

### Step 2 — Discover & Book Events

The user types a natural language request like:

> *"Book 2 tickets for me and Akash. Under $50, prefer weekends, we like jazz. Check our calendars."*

The agent scrapes KYD venues in real-time, extracts the booking intent, optionally checks Google Calendar availability, scores and ranks matching events, and presents numbered options.

### Step 3 — Wallet Confirmation

- **Free events:** Phantom prompts a message signature (no SOL charged)
- **Paid events:** Phantom prompts a SOL transfer (devnet formula: `price / 10000` SOL)

### Step 4 — cNFT Minting

The server mints a compressed NFT ticket for each attendee using Metaplex Bubblegum `mintV1`. The cNFT is owned by the user's Phantom wallet (`leafOwner`). Real transaction hashes are returned with Solana Explorer verification links.

### Step 5 — Email Confirmation

The user provides their email and receives a booking confirmation with all ticket details, transaction hashes, wallet addresses, and Solana Explorer links via Resend.

---

## 📂 Project Structure

```
tickclick/
├── app/
│   ├── page.tsx                    # Main page (chat + wallet gate)
│   ├── components/
│   │   ├── ChatWindow.tsx          # Message display with markdown
│   │   ├── Header.tsx              # App header
│   │   ├── PhantomGate.tsx         # Wallet connect + pay UI
│   │   └── ToolCallPanel.tsx       # Live tool execution sidebar
│   └── api/
│       ├── agent/
│       │   ├── route.ts            # Main chat API endpoint
│       │   └── execute-booking/
│       │       └── route.ts        # Post-wallet booking execution
│       ├── auth/google/
│       │   ├── route.ts            # Google OAuth initiation
│       │   └── callback/route.ts   # OAuth callback handler
│       └── calendar/
│           └── freebusy/route.ts   # Google FreeBusy API
├── agent/
│   ├── index.ts                    # Main agent orchestrator
│   ├── prompts/
│   │   └── system.ts               # System prompt & intent extraction
│   └── tools/
│       ├── scrapeEvents.ts         # Puppeteer KYD venue scraper
│       ├── matchEvents.ts          # Event scoring & ranking
│       ├── checkCalendar.ts        # Calendar availability checker
│       └── executeBooking.ts       # Solana cNFT minting + booking
├── hooks/
│   └── usePhantom.ts               # Phantom wallet React hook
├── lib/
│   ├── solana.ts                   # Solana utilities (mint, transfer, bs58)
│   └── email.ts                    # Resend email integration
├── types/
│   └── index.ts                    # TypeScript type definitions
├── wallets/
│   └── venue-wallet.json           # Venue/authority keypair (gitignored)
├── scripts/
│   ├── setup-wallets.ts            # Wallet generation script
│   ├── airdrop.ts                  # Devnet SOL airdrop script
│   └── create-merkle-tree.ts       # Merkle tree creation script
└── .env.local                      # Environment variables (gitignored)
```

---

## 🔗 On-Chain Details

### cNFT Minting Flow

```
User confirms booking via Phantom
        │
        ▼
Frontend calls POST /api/agent/execute-booking
        │
        ▼
Server loads venue keypair (tree authority)
        │
        ▼
Metaplex Bubblegum mintV1()
  ├── leafOwner = user's Phantom wallet
  ├── merkleTree = project's Merkle tree
  ├── metadata.name = "Event Name — Attendee"
  ├── metadata.symbol = "TICK"
  └── signed by venue wallet (tree authority)
        │
        ▼
Real tx hash returned → Solana Explorer link
```

**Key points:**
- The **venue/authority wallet** signs the minting transaction (server-side)
- The **user's Phantom wallet** is set as the `leafOwner` — they own the cNFT
- Phantom is used for platform fee payment and booking confirmation signatures, **not** for signing the mint tx
- Each cNFT costs ~0.00005 SOL to mint (paid by venue wallet)

### Verifying Tickets

After booking, each ticket includes a clickable Solana Explorer link:

```
https://explorer.solana.com/tx/{TX_HASH}?cluster=devnet
```

The transaction shows the Bubblegum `mintV1` instruction with the leaf owner (user's wallet) visible in the parsed logs.

---

## 🤖 AI Agent Details

### Intent Classification

The agent uses a two-stage LLM pipeline:

1. **Classifier** — Categorizes each message into an action type (zero-shot, temperature 0)
2. **Intent Extractor** — Extracts structured booking data as JSON (attendees, budget, dates, genres)

| Action | Example Triggers |
|---|---|
| `greeting` | "hi", "hello", casual conversation |
| `search_events` | "what's available?", "find jazz events", "show me concerts" |
| `book_ticket` | "book tickets for me and Akash", mentions specific events |
| `confirm_booking` | "#1", "yes", "book it", "go ahead" |
| `provide_email` | Contains an email address after booking |
| `check_calendar` | "check our calendars", "when are we free" |
| `cancel` | "start over", "reset", "cancel" |
| `general_question` | "how does this work?", other questions |

### Tool Execution Pipeline

```
User Message → Classify → Extract Intent → Discover Events → [Check Calendars]
    → Match & Rank → Present Options → Wallet Confirm → Mint cNFT → [Email]
```

Each tool execution is displayed in real-time in the sidebar with animated status indicators (running → completed).

---

## 🗓️ Google Calendar Integration

TixAgent checks real Google Calendar availability via OAuth 2.0:

1. User connects their Google account at `/api/auth/google`
2. Agent uses the **FreeBusy API** to check attendee calendars for conflicts
3. If an event time overlaps with a busy slot, the agent warns before booking

**Setup:**
1. Create OAuth 2.0 credentials in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Enable the **Google Calendar API**
3. Add test users in OAuth consent screen → Test users (while in "Testing" mode)
4. Set redirect URI to `http://localhost:3000/api/auth/google/callback`

**Calendar sharing:** For checking other people's calendars, they need to share their calendar with the authenticated user's email (Settings → Share with specific people → "See all event details").

---

## 💰 Payment Model (Devnet)

| Payment | Amount | Direction |
|---|---|---|
| Platform Access Fee | 0.001 SOL | User → Agent wallet (via Phantom) |
| Free Event Ticket | 0 SOL | Message signature only (via Phantom) |
| Paid Event Ticket | `price_usd / 10000` SOL | User → Venue wallet (via Phantom) |
| cNFT Minting Cost | ~0.00005 SOL | Venue wallet pays (server-side) |

**Examples:** A $50 ticket costs 0.005 SOL on devnet. A $38.89 ticket costs 0.003889 SOL.

*All transactions are on Solana devnet — no real funds are used.*

---

## 🏪 Supported Venues (KYD Labs)

| Venue | URL | Event Type |
|---|---|---|
| Le Poisson Rouge | [lpr.kydlabs.com](https://lpr.kydlabs.com) | Paid events (~$30–$40 range) |
| DJ Mike Nasty | [djmikenasty.kydlabs.com](https://djmikenasty.kydlabs.com) | Mix of free RSVP + paid events |

Events are scraped in real-time from KYD Labs venue pages using Puppeteer. For paid events, prices are extracted from individual event pages (not just the listing page) to ensure accuracy.

---

## 📜 Available Scripts

```bash
npm run dev                # Start development server
npm run build              # Production build
npm run start              # Start production server
npm run setup:wallets      # Generate venue + user wallets
npm run setup:airdrop      # Airdrop devnet SOL to wallets
npm run setup:merkle-tree  # Create Merkle tree for cNFT minting
npm run scrape:test        # Test the event scraper standalone
```

---

## 🔧 Troubleshooting

| Issue | Fix |
|---|---|
| `MetadataUriTooLong` | URI must be < 200 chars. Code uses short placeholder URL. |
| Booking falls back to simulation | Check `.env.local` has `MERKLE_TREE_ADDRESS` + `USER_WALLET_PUBLIC_KEY` set |
| Venue wallet insufficient SOL | Run `solana airdrop 2 <VENUE_PUBKEY> --url devnet` |
| Google OAuth `invalid_client` | Re-copy Client ID + Secret from Google Cloud Console (use copy button) |
| Phantom not detected | Install [Phantom](https://phantom.app/) browser extension |
| Scraper returns 0 events | Puppeteer may need `--no-sandbox` flag; check KYD venue URLs are accessible |

---

## 🛠️ Hackathon Bounties

| Bounty | Integration |
|---|---|
| **KYD Labs** | Real-time event scraping from KYD-powered venues, cNFT tickets for KYD events |
| **Solana** | Real compressed NFT minting on devnet via Metaplex Bubblegum, Phantom wallet integration |

---

## 📄 License

Built for the Solana Graveyard Hackathon (February 2026).

---

**Built with ❤️ by 0xNitish | Powered by Solana, KYD Labs, Metaplex Bubblegum, and Groq**
