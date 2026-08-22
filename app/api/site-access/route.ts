import { NextResponse } from "next/server";

import { preflight, withCors } from "@/lib/cors";
import { cacheGet, cacheSet, limitOr429 } from "@/lib/rate-limit";
import { MODEL_TAG, observeSite, unusable } from "@/lib/site-vision";
import { parseCoords, readJsonBody } from "@/lib/validate";

import type { SiteObservation } from "@/lib/site-vision";

/**
 * What can we see around this property?
 *
 * Returns observations about site access — frontage, parking, whether a lorry
 * can get close, whether scaffold can reach the rear. The widget turns those
 * into money; nothing here prices anything.
 *
 * Never fails a quote. Every error path returns an unusable observation with
 * 200, because this is an accuracy improvement, not a dependency: a quote that
 * dies because Street View was slow is far worse than one priced without
 * knowing about a pavement licence.
 */

// Two image fetches plus a vision call. The individual timeouts inside
// site-vision are tighter than this; the ceiling is a backstop.
export const maxDuration = 25;

const CACHE_DAYS = 30;

/**
 * ~5 decimal places is about a metre. Neighbouring houses get their own entry,
 * but the same house re-quoted — or two people on the same pin — is free.
 * Prompt version AND model are in the key, so changing either invalidates old
 * answers rather than mixing two generations of judgement in one dataset.
 */
function cacheKey(lat: number, lng: number): string {
  return `site:v${MODEL_TAG}:${lat.toFixed(5)}:${lng.toFixed(5)}`;
}

export function OPTIONS(request: Request) {
  return preflight(request);
}

export const POST = withCors(async (request: Request) => {
  const limited = await limitOr429(request, "solar");
  if (limited) return limited;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.error }, { status: 400 });
  }

  const coordsResult = parseCoords(bodyResult.value);
  if (!coordsResult.ok) {
    // Same shape as any other miss, so a rejected coordinate does not tell a
    // caller anything about our geographic bounds.
    return NextResponse.json({ observation: unusable() });
  }
  const coords = coordsResult.value;

  const key = cacheKey(coords.lat, coords.lng);
  const cached = await cacheGet<{ observation: SiteObservation }>(key);
  if (cached?.observation) {
    return NextResponse.json({ observation: cached.observation, cached: true });
  }

  const mapsKey =
    process.env.GOOGLE_MAPS_SERVER_API_KEY ?? process.env.GOOGLE_SOLAR_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Unconfigured is a normal state, not an error: the feature simply has not
  // been switched on yet, and the quote should carry on exactly as before.
  if (!mapsKey || !geminiKey) {
    return NextResponse.json({ observation: unusable(), reason: "not_configured" });
  }

  const observation = await observeSite(coords, { mapsKey, geminiKey });

  // Only cache a real look. Caching a failure would pin a transient outage to
  // an address for a month.
  if (observation.imageryUsable) {
    await cacheSet(key, { observation }, CACHE_DAYS * 24 * 60 * 60);
  }

  return NextResponse.json({ observation });
});
