// =============================================
// TixAgent — TicketManager Smart Contract
// Anchor program for atomic ticket operations on Solana
// =============================================

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("9HUu9SZsUCbZL2Fd3dKBy2zzAKiMRVbP9y6QH5ZD1N5q"); // Replace after deploy

#[program]
pub mod ticket_manager {
    use super::*;

    /// Purchase and mint a ticket atomically.
    /// Transfers SOL from buyer to venue, then creates a ticket PDA.
    /// For free events, set price to 0 and payment is skipped.
    pub fn purchase_ticket(
        ctx: Context<PurchaseTicket>,
        event_id: String,
        event_name: String,
        event_date: i64,
        venue: String,
        attendee_name: String,
        price_lamports: u64,
        cnft_asset_id: Pubkey,
    ) -> Result<()> {
        // Transfer SOL if not a free event
        if price_lamports > 0 {
            let cpi_context = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.venue.to_account_info(),
                },
            );
            system_program::transfer(cpi_context, price_lamports)?;
            msg!("Payment of {} lamports transferred to venue", price_lamports);
        } else {
            msg!("Free event — no payment required");
        }

        // Initialize the ticket PDA
        let ticket = &mut ctx.accounts.ticket;
        ticket.event_id = event_id;
        ticket.event_name = event_name;
        ticket.event_date = event_date;
        ticket.venue = venue;
        ticket.attendee_name = attendee_name;
        ticket.price_paid = price_lamports;
        ticket.ticket_status = TicketStatus::Active;
        ticket.cnft_asset_id = cnft_asset_id;
        ticket.owner = ctx.accounts.buyer.key();
        ticket.created_at = Clock::get()?.unix_timestamp;
        ticket.bump = ctx.bumps.ticket;

        msg!("Ticket created for {} — Status: Active", ticket.attendee_name);
        Ok(())
    }

    /// Redeem a ticket at the venue entrance.
    /// Only callable by the venue authority.
    /// Marks ticket as Redeemed, preventing reuse.
    pub fn redeem_ticket(ctx: Context<RedeemTicket>) -> Result<()> {
        let ticket = &mut ctx.accounts.ticket;

        require!(
            ticket.ticket_status == TicketStatus::Active,
            TicketError::TicketNotActive
        );

        ticket.ticket_status = TicketStatus::Redeemed;

        msg!(
            "Ticket redeemed for {} at {}",
            ticket.attendee_name,
            ticket.venue
        );
        Ok(())
    }

    /// Get ticket information (view-only helper).
    /// In practice, ticket data is read directly from the PDA account.
    pub fn get_ticket_info(ctx: Context<GetTicketInfo>) -> Result<()> {
        let ticket = &ctx.accounts.ticket;

        msg!("=== Ticket Info ===");
        msg!("Event: {}", ticket.event_name);
        msg!("Venue: {}", ticket.venue);
        msg!("Attendee: {}", ticket.attendee_name);
        msg!("Date: {}", ticket.event_date);
        msg!("Price: {} lamports", ticket.price_paid);
        msg!("Status: {:?}", ticket.ticket_status);
        msg!("Owner: {}", ticket.owner);
        msg!("cNFT: {}", ticket.cnft_asset_id);

        Ok(())
    }
}

// --- Account Structures ---

#[derive(Accounts)]
#[instruction(event_id: String, event_name: String, event_date: i64, venue: String, attendee_name: String)]
pub struct PurchaseTicket<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Venue wallet receives payment. Not validated beyond being writable.
    #[account(mut)]
    pub venue: AccountInfo<'info>,

    #[account(
        init,
        payer = buyer,
        space = Ticket::SIZE,
        seeds = [
            b"ticket",
            event_id.as_bytes(),
            attendee_name.as_bytes(),
            buyer.key().as_ref(),
        ],
        bump,
    )]
    pub ticket: Account<'info, Ticket>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RedeemTicket<'info> {
    /// Venue authority — only the venue can redeem tickets
    pub venue_authority: Signer<'info>,

    #[account(
        mut,
        constraint = ticket.ticket_status == TicketStatus::Active @ TicketError::TicketNotActive,
    )]
    pub ticket: Account<'info, Ticket>,
}

#[derive(Accounts)]
pub struct GetTicketInfo<'info> {
    pub ticket: Account<'info, Ticket>,
}

// --- Data Structures ---

#[account]
pub struct Ticket {
    pub event_id: String,       // 4 + 64 bytes
    pub event_name: String,     // 4 + 128 bytes
    pub event_date: i64,        // 8 bytes
    pub venue: String,          // 4 + 64 bytes
    pub attendee_name: String,  // 4 + 64 bytes
    pub price_paid: u64,        // 8 bytes
    pub ticket_status: TicketStatus, // 1 byte
    pub cnft_asset_id: Pubkey,  // 32 bytes
    pub owner: Pubkey,          // 32 bytes
    pub created_at: i64,        // 8 bytes
    pub bump: u8,               // 1 byte
}

impl Ticket {
    // Discriminator (8) + all fields
    pub const SIZE: usize = 8 + (4 + 64) + (4 + 128) + 8 + (4 + 64) + (4 + 64) + 8 + 1 + 32 + 32 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum TicketStatus {
    Active,
    Redeemed,
    Cancelled,
}

// --- Errors ---

#[error_code]
pub enum TicketError {
    #[msg("Ticket is not in Active status")]
    TicketNotActive,
    #[msg("Unauthorized: only venue can redeem tickets")]
    UnauthorizedRedemption,
}
