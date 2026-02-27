# 🎟️ TixAgent — AI-Powered Ticket Booking Agent

> **Solana Graveyard Hackathon × KYD Labs x Audius**
> An AI concierge that discovers live events, checks calendar availability, plays related music and books real on-chain compressed NFT (cNFT) tickets on Solana devnet.

---

## 🧠 What is TixAgent?

TixAgent is a conversational AI agent that handles the entire ticket booking lifecycle:

1. **Discover Events** — Scrapes real events from KYD Labs-powered venues (Le Poisson Rouge, DJ Mike Nasty) using Puppeteer, including live pricing from individual event pages.
2. **Understand Intent** — Parses natural language requests to extract attendees, budgets, date preferences and genre interests.
3. **Check Calendars & Auto-Book Events** — Integrates with Google Calendar via OAuth 2.0 to check attendee availability before booking, and automatically creates a calendar event with invites for all attendees after a successful booking.
4. **Match & Recommend** — Scores and ranks events based on user preferences, budget and calendar availability.
5. **Wallet-Gated Payments** — Enforces Phantom wallet confirmation for all bookings — SOL transfers for paid events, cryptographic message signatures for free events.
6. **Mint On-Chain Tickets** — Mints real compressed NFTs (cNFTs) on Solana devnet via Metaplex Bubblegum, with each ticket owned by the user's Phantom wallet.
7. **Discover Music** — Searches Audius (decentralized music protocol) for artist tracks and genre-based trending music related to booked events.
8. **Email Confirmations** — Sends booking confirmation emails via Resend with ticket details, transaction hashes and Solana Explorer links.

---

## 🔌 APIs & Services Integrated

This project integrates **9 external APIs and services** across AI, blockchain, identity, communication and music — wired together through a single conversational interface.

### 🤖 AI & Language Model

| Service | What It Does | Integration Detail |
|---|---|---|
| **Groq API** (Llama 3.3 70B Versatile) | Powers the entire conversational agent — intent classification, structured data extraction, genre inference and natural language responses | Two-stage LLM pipeline: zero-shot classifier (temperature 0) for action routing + JSON-mode extractor for structured booking intent. Also used for Audius genre inference when artist isn't found directly. |

### ⛓️ Blockchain & Wallet

| Service | What It Does | Integration Detail |
|---|---|---|
| **Solana Web3.js** | All on-chain transactions — SOL transfers, wallet connections, transaction confirmations | Devnet RPC calls for building, signing and confirming transactions. Platform fee transfers, ticket payment transfers and cNFT minting all go through this. |
| **Metaplex Bubblegum** | Compressed NFT ticket minting | `mintV1` instruction against a pre-initialized Merkle tree. Each ticket is a cNFT with `leafOwner` set to the user's Phantom wallet. Venue wallet signs as tree authority (server-side). |
| **Phantom Wallet** | User-facing wallet for payments, signatures and identity | Browser extension integration via `usePhantom` React hook. Supports `connect` (with `onlyIfTrusted` auto-reconnect), `signMessage` (free events), `signAndSendTransaction` (paid events). Survives OAuth redirects via eager reconnection. |

### 📅 Calendar & Identity

| Service | What It Does | Integration Detail |
|---|---|---|
| **Google OAuth 2.0** | Authenticates users for calendar access | Full OAuth redirect flow: `/api/auth/google` → Google consent screen → `/api/auth/google/callback` → token passed to frontend via URL hash fragment. Token stored in React state with expiry tracking. Uses `calendar.events` scope for both read and write access. |
| **Google Calendar API** (FreeBusy + Events) | Pre-booking conflict detection and post-booking event creation | **Before booking:** FreeBusy queries check each attendee's calendar for conflicts. **After booking:** Creates a 2-hour calendar event with venue location, on-chain ticket details in the description, and sends Google Calendar invites to all attendees automatically via `sendUpdates=all`. |

### 📧 Communication

| Service | What It Does | Integration Detail |
|---|---|---|
| **Resend API** | Sends booking confirmation emails | HTML emails containing: event details, attendee names, cNFT IDs, mint transaction hashes, Solana Explorer verification links, wallet addresses and payment information. |

### 🎵 Music Discovery

| Service | What It Does | Integration Detail |
|---|---|---|
| **Audius API** | Decentralized music discovery — artist search, track listings, genre trending | Three-step pipeline: (1) Search for artist on Audius, (2) If not found, infer genre via Groq LLM, (3) Fetch trending tracks for that genre. Returns tracks with play counts, artwork, duration and deep links to Audius. Post-booking music player renders inline with ticket cards. |

### 🎫 Event Data

| Service | What It Does | Integration Detail |
|---|---|---|
| **KYD Labs Venues** (Web Scraping) | Real-time event discovery from live venue pages | Puppeteer-based scraper hits `lpr.kydlabs.com` and `djmikenasty.kydlabs.com`. Extracts event names, dates, times, venues and prices. For paid events, follows through to individual event pages to scrape exact ticket prices (not just listing-page data). |

---

## 🔄 Agent Workflow Pipeline

Every booking request follows an enforced 9-step pipeline. The ordering is baked into both the LLM system prompt and code-level gates — the agent **cannot** skip steps.

```
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  1. PARSE    │───▶│  2. DISCOVER     │───▶│  3. MATCH &     │
│  INTENT      │    │  EVENTS          │    │  FILTER         │
│              │    │                  │    │                 │
│ Extract:     │    │ Scrape KYD Labs  │    │ Score by budget │
│ • attendees  │    │ venues via       │    │ genre, day,     │
│ • budget     │    │ Puppeteer        │    │ calendar slots  │
│ • genre      │    │                  │    │                 │
│ • dates      │    │                  │    │                 │
└──────────────┘    └──────────────────┘    └────────┬────────┘
                                                     │
                                                     ▼
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  6. WALLET   │◀───│  5. PRESENT      │◀───│  4. CHECK       │
│  PAYMENT     │    │  OPTIONS         │    │  CALENDAR       │
│              │    │                  │    │  ⚠️ MANDATORY    │
│ Paid: SOL    │    │ Show events with │    │                 │
│ transfer via │    │ calendar status: │    │ Google FreeBusy │
│ Phantom      │    │ ✅ Free          │    │ for ALL         │
│              │    │ ⚠️ Conflict      │    │ attendees       │
│ Free: Msg    │    │ 📅 Not checked   │    │                 │
│ signature    │    │                  │    │                 │
└──────┬───────┘    └──────────────────┘    └─────────────────┘
       │
       ▼
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  7. MINT     │───▶│  8. ADD TO       │───▶│  9. EMAIL       │
│  cNFT        │    │  CALENDAR        │    │  CONFIRMATION   │
│  TICKETS     │    │  📅 AUTO         │    │                 │
│              │    │                  │    │ Send via Resend  │
│ Metaplex     │    │ Create event on  │    │ with tx hashes,  │
│ Bubblegum    │    │ Google Calendar  │    │ Explorer links,  │
│ mintV1       │    │ + send invites   │    │ ticket details   │
│              │    │ to all attendees │    │                 │
└──────────────┘    └──────────────────┘    └─────────────────┘
```

### Code-Enforced Gates

The pipeline isn't just a suggestion to the LLM — critical steps are **enforced in code**:

| Gate | Rule | Enforcement |
|---|---|---|
| **Calendar Gate** | Cannot proceed to payment without calendar check (when connected) | `executeAndRespond()` blocks and requests attendee emails if calendar is connected but emails are missing |
| **Wallet Gate** | Cannot mint paid-event tickets without wallet payment | `proceedToPayment()` blocks and asks user to connect Phantom if wallet is missing for paid events |
| **Conflict Gate** | Cannot book conflicting events without explicit user acknowledgment | Agent sets `awaitingBookAnyway` state and requires "book anyway" confirmation |
| **Email Gate** | Cannot email confirmation without a completed booking | `handleEmailSend()` checks `lastBookingResult` before attempting to send |

---

## ✨ Key Features

### 🔐 Wallet-Gated Platform Access
Every user pays a **one-time 0.001 SOL platform fee** through Phantom before unlocking the AI agent. This micro-payment flows directly to the agent's on-chain wallet, creating a verifiable revenue trail on Solana — and ensures only committed users interact with the booking engine.

### ✍️ Cryptographic Booking Confirmation for Free Events
Free doesn't mean unsigned. When a user books a free event, TixAgent prompts a **Phantom message signature** — a cryptographic proof-of-intent that ties the booking to the user's wallet identity. No SOL leaves the wallet, but the signed message serves as an immutable, wallet-verified confirmation that the attendee genuinely requested the ticket.

### 💸 Real On-Chain Payments for Paid Events
Since the project runs on **Solana devnet**, TixAgent simulates real-world ticket economics using a deterministic pricing formula: **`ticket_price_usd / 10,000` SOL**. A $50 ticket costs 0.005 devnet SOL. The user approves a real SOL transfer through Phantom to the venue wallet — producing a fully verifiable payment transaction on Solana Explorer, identical to how a production deployment would work on mainnet.

### 📅 Automatic Google Calendar Booking with Attendee Invites
After a successful ticket booking, TixAgent **automatically creates a Google Calendar event** for the show — blocked as a 2-hour slot at the event's start time, with the venue as the location and on-chain ticket details (cNFT IDs, Solana Explorer links) embedded in the event description. All attendees receive **Google Calendar invites automatically**, so everyone's calendar is blocked and nobody forgets the show. No manual step needed — it happens right after minting.

### 📅 Book Tickets on Behalf of Anyone via Shared Calendars
TixAgent doesn't just book for the logged-in user — it can **check availability and book tickets for any group of people** whose Google Calendars are shared with the authenticated account. A team lead can book for their entire team, a friend can book for their group — as long as calendar access is shared, the agent handles conflict detection and multi-attendee booking seamlessly.

### 🎵 Audius Music Discovery
After booking tickets, TixAgent surfaces **related music from Audius** — the decentralized music streaming protocol. The agent infers the genre of the booked event via LLM, searches Audius for matching artist tracks or trending songs and renders an inline music player with play counts, artwork and deep links to Audius. Users can also search for music directly by saying "play some jazz" or "find tracks by [artist]".

### 🧰 Live Agent Toolchain Visibility
Every action the AI agent takes — from scraping venues to checking calendars to minting cNFTs — is displayed in a **real-time sidebar** with animated status indicators. Users watch each tool spin up, execute and complete, providing full transparency into the agent's decision-making pipeline. Nothing happens behind a black box.

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
│  ┌──────▼──────────────▼────────────────────────────────┐│
│  │              Agent Tools                             ││
│  │  ┌───────────┐ ┌──────────┐ ┌─────────────────┐     ││
│  │  │ Scraper   │ │ Calendar │ │ Event Matcher   │     ││
│  │  │(Puppeteer)│ │(Google)  │ │(Score & Rank)   │     ││
│  │  └───────────┘ └──────────┘ └─────────────────┘     ││
│  │  ┌───────────────────┐ ┌──────────────────────────┐ ││
│  │  │ Booking Executor  │ │ Email Sender (Resend)    │ ││
│  │  │ (Solana cNFT Mint)│ │                          │ ││
│  │  └────────┬──────────┘ └──────────────────────────┘ ││
│  │  ┌────────▼──────────┐                               ││
│  │  │ Audius Discovery  │                               ││
│  │  │ (Music + Genre)   │                               ││
│  │  └───────────────────┘                               ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
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
| Calendar | Google Calendar API (OAuth 2.0 + FreeBusy + Events) |
| Music | Audius API (decentralized music protocol) |
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
git clone https://github.com/Nitish-d-Great/tickclick.git
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
SOLANA_NETWORK=devnet

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

The agent scrapes KYD venues in real-time, extracts the booking intent, optionally checks Google Calendar availability, scores and ranks matching events and presents numbered options.

### Step 3 — Wallet Confirmation

- **Free events:** Phantom prompts a message signature (no SOL charged)
- **Paid events:** Phantom prompts a SOL transfer (devnet formula: `price / 10000` SOL)

### Step 4 — cNFT Minting

The server mints a compressed NFT ticket for each attendee using Metaplex Bubblegum `mintV1`. The cNFT is owned by the user's Phantom wallet (`leafOwner`). Real transaction hashes are returned with Solana Explorer verification links.

### Step 5 — Automatic Calendar Booking

If Google Calendar is connected, TixAgent automatically creates a calendar event for the show — a 2-hour block at the event's start time with the venue as the location. All attendees receive Google Calendar invites, so everyone's schedule is blocked. On-chain ticket details (cNFT IDs, Explorer links) are embedded in the event description.

### Step 6 — Music Discovery

After booking, an inline Audius player appears with music related to the event. Users can also discover music independently by asking the agent.

### Step 7 — Email Confirmation

The user provides their email and receives a booking confirmation with all ticket details, transaction hashes, wallet addresses and Solana Explorer links via Resend.

---

## 📂 Project Structure

```
tickclick/
├── app/
│   ├── page.tsx                    # Main page (chat + wallet gate)
│   ├── components/
│   │   ├── ChatWindow.tsx          # Message display with markdown
│   │   ├── AudiusPlayer.tsx        # Post-booking music player
│   │   ├── TicketCard.tsx          # Visual NFT ticket cards
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
│       ├── audius/
│       │   └── discover/route.ts   # Audius music search endpoint
│       ├── calendar/
│       │   └── freebusy/route.ts   # Google FreeBusy API
│       └── ticket-metadata/
│           └── [id]/route.ts       # On-chain NFT metadata JSON
├── agent/
│   ├── index.ts                    # Main agent orchestrator
│   ├── prompts/
│   │   └── system.ts               # Dynamic system prompt + intent extraction
│   └── tools/
│       ├── scrapeEvents.ts         # Puppeteer KYD venue scraper
│       ├── matchEvents.ts          # Event scoring & ranking
│       ├── checkCalendar.ts        # Calendar checker + event creator
│       └── executeBooking.ts       # Solana cNFT minting + booking
├── hooks/
│   └── usePhantom.ts               # Phantom wallet React hook
├── lib/
│   ├── solana.ts                   # Solana utilities (mint, transfer, bs58)
│   ├── audius.ts                   # Audius API client (search, trending, genres)
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
        │
        ▼
Google Calendar event auto-created
  ├── summary = "🎟️ Event Name"
  ├── location = venue name
  ├── duration = 2 hours
  ├── description = cNFT IDs + Explorer links
  └── attendees = all emails → calendar invites sent
```

**Key points:**
- The **venue/authority wallet** signs the minting transaction (server-side)
- The **user's Phantom wallet** is set as the `leafOwner` — they own the cNFT
- Phantom is used for platform fee payment and booking confirmation signatures, **not** for signing the mint tx
- Each cNFT costs ~0.00005 SOL to mint (paid by venue wallet)
- After minting, a **Google Calendar event is automatically created** with invites sent to all attendees

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
| `greeting` | "hi", "hello", "thank you", casual conversation |
| `search_events` | "what's available?", "find jazz events", "show me concerts" |
| `book_ticket` | "book tickets for me and Akash", mentions specific events |
| `confirm_booking` | "#1", "yes", "book it", "go ahead" |
| `provide_email` | Contains an email address after booking |
| `check_calendar` | "check our calendars", "when are we free" |
| `discover_music` | "play some jazz", "find tracks by [artist]", "music for this event" |
| `cancel` | "start over", "reset", "cancel" |
| `book_anyway` | "book anyway", "ignore the conflict", "proceed" (after calendar conflict) |
| `general_question` | "how does this work?", other questions |

### Dynamic System Prompt

The system prompt is **not static** — it's rebuilt on every LLM call with live context:

```typescript
getSystemPrompt({
  calendarConnected: true,        // Shows "Calendar: ✅ CONNECTED"
  calendarEmail: "user@gmail.com",
  walletConnected: true,          // Shows "Wallet: ✅ CONNECTED (91B1...5dp7)"
  walletAddress: "91B1...5dp7",
})
```

This ensures the LLM always knows the current state of calendar and wallet connections, preventing it from skipping steps that depend on connected services.

---

## 🗓️ Google Calendar Integration

TixAgent uses Google Calendar for both **pre-booking conflict detection** and **post-booking event creation**:

### Before Booking (FreeBusy API)
1. User connects their Google account at `/api/auth/google`
2. Agent uses the **FreeBusy API** to check attendee calendars for conflicts
3. If an event time overlaps with a busy slot, the agent warns before booking
4. User can choose to "book anyway" or pick a different event

### After Booking (Events API)
5. Once tickets are minted, agent **automatically creates a Google Calendar event**
6. Event includes: 🎟️ event name as title, venue as location, 2-hour duration
7. On-chain ticket details (cNFT IDs, Solana Explorer links) are embedded in the event description
8. All attendees receive **Google Calendar invites** automatically via `sendUpdates=all`
9. Reminders are set for 1 day before and 1 hour before the event

### Setup
1. Create OAuth 2.0 credentials in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Enable the **Google Calendar API**
3. Add test users in OAuth consent screen → Test users (while in "Testing" mode)
4. Set redirect URI to `http://localhost:3000/api/auth/google/callback`

**OAuth Scope:** The app requests `calendar.events` — this allows both reading availability and creating events. Users will see a consent screen asking to "View and edit events on all your calendars".

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
| Le Poisson Rouge | [lpr.kydlabs.com](https://lpr.kydlabs.com) | Paid events (~$30–$100+ range) |
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
| Calendar event creation fails (403) | Reconnect Google Calendar — the app needs `calendar.events` scope for write access |
| Phantom not detected | Install [Phantom](https://phantom.app/) browser extension |
| Phantom disconnects after OAuth | Hook uses `connect({ onlyIfTrusted: true })` for auto-reconnect |
| Scraper returns 0 events | Puppeteer may need `--no-sandbox` flag; check KYD venue URLs are accessible |
| Email confirmation fails | Ensure booking was completed before requesting email — check console for `[Client] Stored bookingResult` |

---

## 🛠️ Hackathon Bounties

| Bounty | Integration |
|---|---|
| **KYD Labs** | Real-time event scraping from KYD-powered venues, cNFT tickets for KYD events |
| **Solana Main Prize** | Real compressed NFT minting on devnet via Metaplex Bubblegum, Phantom wallet integration - Most Importantly, a fully functional consumer app on Solana |
| **Audius** | Post-booking music discovery using Audius REST API — artist search, LLM-powered genre inference and trending track surfacing with an inline player. Empowers artists by connecting live event attendees directly to their music on the decentralized protocol. |

---

## 📄 License

Built for the Solana Graveyard Hackathon (February 2026).

---

**Built with ❤️ by 0xNitish | Powered by Solana, KYD Labs, Metaplex Bubblegum, Groq, Audius and Google Calendar**