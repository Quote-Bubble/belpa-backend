import { preflight, withCors } from "@/lib/cors";
import { getServiceSupabase } from "@/lib/supabase";
import { cacheGet, cacheSet, limitOr429 } from "@/lib/rate-limit";
import { defaultQuoteConfig, parseQuoteConfig } from "@/lib/quote-config";

import { NextResponse } from "next/server";

// Kept short while roofers are actively set up so pricing/service changes
// surface within seconds. Raise once there's real homeowner traffic.
const CACHE_TTL_SECONDS = 20;

function originMatches(allowed: string[], candidate: string): boolean {
  try {
    const host = new URL(candidate).origin;
    return allowed.some((a) => {
      try {
        return new URL(a).origin === host || a === host || a === candidate;
      } catch {
        return a === host || a === candidate;
      }
    });
  } catch {
    return allowed.includes(candidate);
  }
}

/**
 * Per-roofer embed lock.
 * - Empty allowlist → anywhere (Link + any site).
 * - `?host=` from widget.js / launch.js → must match (the parent site).
 * - No `host` → allowed (hosted /l link opened directly, or first-party).
 * Origin/Referer alone are NOT used: browser calls come from the widget
 * origin inside the iframe, not the roofer site.
 */
function originAllowed(
  allowed: string[] | null | undefined,
  request: Request,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  const host = new URL(request.url).searchParams.get("host")?.trim();
  if (!host) return true;
  return originMatches(allowed, host);
}

/**
 * Public roofer lookup by slug — branding + quote config for the widget.
 */
async function handleGet(request: Request) {
  const limited = await limitOr429(request, "roofer");
  if (limited) return limited;

  const slug = new URL(request.url).searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json(
      { error: "A roofer slug is required." },
      { status: 400 },
    );
  }

  const embedHost =
    new URL(request.url).searchParams.get("host")?.trim().toLowerCase() ||
    "any";
  const cacheKey = `roofer:config:${slug.toLowerCase()}:${embedHost}`;
  const cached = await cacheGet<{
    roofer: { slug: string; name: string };
    config: unknown;
  }>(cacheKey);

  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        "cache-control": "public, max-age=20, s-maxage=20",
      },
    });
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Roofer lookup is temporarily unavailable." },
      { status: 503 },
    );
  }

  const { data: roofer, error } = await supabase
    .from("roofers")
    .select("id,slug,name,allowed_origins")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Roofer lookup failed", error);
    return NextResponse.json(
      { error: "Roofer lookup is temporarily unavailable." },
      { status: 502 },
    );
  }

  if (!roofer) {
    return NextResponse.json({ error: "Roofer not found." }, { status: 404 });
  }

  const allowed = (roofer.allowed_origins as string[] | null) ?? [];
  if (!originAllowed(allowed, request)) {
    return NextResponse.json(
      { error: "This quote form is not available from this site." },
      { status: 403 },
    );
  }

  const { data: pricing } = await supabase
    .from("roofer_pricing")
    .select("quote_config,vat_registered")
    .eq("roofer_id", roofer.id)
    .maybeSingle();

  let config = pricing?.quote_config
    ? parseQuoteConfig(pricing.quote_config)
    : defaultQuoteConfig();
  if (pricing?.vat_registered != null) {
    config = { ...config, vatRegistered: pricing.vat_registered as boolean };
  }

  const body = {
    roofer: { slug: roofer.slug as string, name: roofer.name as string },
    config,
  };

  await cacheSet(cacheKey, body, CACHE_TTL_SECONDS);

  return NextResponse.json(body, {
    headers: {
      "cache-control": "public, max-age=20, s-maxage=20",
    },
  });
}

export const GET = withCors(handleGet);
export const OPTIONS = preflight;
