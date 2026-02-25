// =============================================
// Google OAuth — Callback handler
// GET /api/auth/google/callback?code=xxx
// Exchanges auth code for access token, redirects to app
// =============================================

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    console.error("[Google OAuth] Error:", error);
    return NextResponse.redirect(
      new URL("/?calendar_error=" + encodeURIComponent(error), request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/?calendar_error=no_code", request.url)
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/api/auth/google/callback";

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/?calendar_error=missing_credentials", request.url)
    );
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("[Google OAuth] Token exchange failed:", tokenData);
      return NextResponse.redirect(
        new URL("/?calendar_error=token_exchange_failed", request.url)
      );
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // Get user's email for display
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const userInfo = await userInfoResponse.json();
    const userEmail = userInfo.email || "";

    console.log(`[Google OAuth] Successfully authenticated: ${userEmail}`);

    // Redirect back to app with token in URL hash (not visible to server, stored in browser)
    // Using hash fragment so the token stays client-side only
    const redirectUrl = new URL("/", request.url);
    redirectUrl.hash = `calendar_token=${access_token}&calendar_email=${encodeURIComponent(userEmail)}&calendar_expires=${Date.now() + expires_in * 1000}`;

    return NextResponse.redirect(redirectUrl.toString());
  } catch (err: any) {
    console.error("[Google OAuth] Error:", err.message);
    return NextResponse.redirect(
      new URL("/?calendar_error=server_error", request.url)
    );
  }
}