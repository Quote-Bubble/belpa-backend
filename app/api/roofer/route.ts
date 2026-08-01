import { preflight, withCors } from "@/lib/cors";
import { getServiceSupabase } from "@/lib/supabase";
import { cacheGet, cacheSet, limitOr429 } from "@/lib/rate-limit";
import { defaultQuoteConfig, parseQuoteConfig } from "@/lib/quote-config";

import { NextResponse } from "next/server";

const CACHE_TTL_SECONDS = 120;

function originAllowed(
  allowed: string[] | null | undefined,
  request: Request,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const candidates = [origin, referer].filter(Boolean) as string[];
  if (candidates.length === 0) return true;
  return candidates.some((c) => {
    try {
      const host = new URL(c).origin;
      return allowed.some((a) => {
        try {
          return new URL(a).origin === host || a === host || a === c;
        } catch {
          return a === host || a === c;
        }
      });
    } catch {
      return false;
    }
  });
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

  const cacheKey = `roofer:config:${slug.toLowerCase()}`;
  const cached = await cacheGet<{
    roofer: { slug: string; name: string };
    config: unknown;
  }>(cacheKey);

  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        "cache-control": "public, max-age=60, s-maxage=120",
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
      "cache-control": "public, max-age=60, s-maxage=120",
    },
  });
}

export const GET = withCors(handleGet);
export const OPTIONS = preflight;
