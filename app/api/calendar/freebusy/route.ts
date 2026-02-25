// =============================================
// Google Calendar FreeBusy API
// POST /api/calendar/freebusy
// Checks availability for multiple email addresses
// =============================================

import { NextRequest, NextResponse } from "next/server";

export interface FreeBusyRequest {
  calendarToken: string;
  emails: string[];
  timeMin: string; // ISO datetime
  timeMax: string; // ISO datetime
}

export interface BusyBlock {
  start: string;
  end: string;
  summary?: string;
}

export interface AttendeeAvailability {
  email: string;
  busy: BusyBlock[];
  isFree: boolean;
  error?: string;
}

export interface FreeBusyResponse {
  success: boolean;
  attendees: AttendeeAvailability[];
  allFree: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: FreeBusyRequest = await request.json();
    const { calendarToken, emails, timeMin, timeMax } = body;

    if (!calendarToken) {
      return NextResponse.json(
        { success: false, error: "No calendar token provided" },
        { status: 400 }
      );
    }

    if (!emails || emails.length === 0) {
      return NextResponse.json(
        { success: false, error: "No email addresses provided" },
        { status: 400 }
      );
    }

    console.log(`\n[Calendar] Checking availability for ${emails.length} attendee(s)`);
    console.log(`   Time range: ${timeMin} — ${timeMax}`);
    console.log(`   Emails: ${emails.join(", ")}`);

    // Call Google Calendar FreeBusy API
    const freeBusyResponse = await fetch(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${calendarToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: emails.map((email) => ({ id: email })),
        }),
      }
    );

    if (!freeBusyResponse.ok) {
      const errorData = await freeBusyResponse.json();
      console.error("[Calendar] FreeBusy API error:", errorData);

      // Token expired
      if (freeBusyResponse.status === 401) {
        return NextResponse.json(
          { success: false, error: "Calendar token expired. Please reconnect Google Calendar." },
          { status: 401 }
        );
      }

      return NextResponse.json(
        { success: false, error: `Google Calendar API error: ${errorData.error?.message || "Unknown error"}` },
        { status: freeBusyResponse.status }
      );
    }

    const data = await freeBusyResponse.json();
    const calendars = data.calendars || {};

    const attendees: AttendeeAvailability[] = emails.map((email) => {
      const calendarData = calendars[email];

      if (!calendarData) {
        console.log(`   ⚠️ ${email}: No calendar data (calendar may not be shared)`);
        return {
          email,
          busy: [],
          isFree: true, // Assume free if can't check
          error: "Calendar not accessible — may not be shared",
        };
      }

      if (calendarData.errors && calendarData.errors.length > 0) {
        const errMsg = calendarData.errors[0]?.reason || "unknown";
        console.log(`   ⚠️ ${email}: Calendar error — ${errMsg}`);
        return {
          email,
          busy: [],
          isFree: true, // Assume free on error
          error: `Calendar error: ${errMsg}`,
        };
      }

      const busyBlocks: BusyBlock[] = (calendarData.busy || []).map(
        (block: any) => ({
          start: block.start,
          end: block.end,
        })
      );

      const isFree = busyBlocks.length === 0;
      if (isFree) {
        console.log(`   ✅ ${email}: FREE`);
      } else {
        console.log(`   🔴 ${email}: BUSY (${busyBlocks.length} conflict(s))`);
        busyBlocks.forEach((b) => {
          console.log(`      ${b.start} — ${b.end}`);
        });
      }

      return { email, busy: busyBlocks, isFree };
    });

    const allFree = attendees.every((a) => a.isFree);

    console.log(`   → Overall: ${allFree ? "ALL FREE ✅" : "CONFLICTS DETECTED 🔴"}\n`);

    return NextResponse.json({
      success: true,
      attendees,
      allFree,
    } as FreeBusyResponse);
  } catch (err: any) {
    console.error("[Calendar] FreeBusy error:", err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}