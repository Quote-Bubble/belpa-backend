import { loggedFetch } from "@/lib/logged-fetch";

/**
 * Look at a property from the street and from above, and report what is there.
 *
 * Strictly perception. This module never returns a price, a multiplier or a
 * score — only observations, which the widget's lib/site-access.ts turns into
 * money. That split is the whole design: a model-generated price is
 * unauditable, drifts when Google updates the model, and cannot be defended to
 * a roofer who disagrees with it. "Is there a double yellow line outside this
 * house" is a question with a checkable answer.
 *
 * Every field carries its own confidence, because the pricing side treats an
 * unsure observation completely differently from a confident one: unsure
 * widens the estimate's range, confident adds a costed line.
 */

export type SiteObservation = {
  frontage: "on_pavement" | "small_setback" | "driveway_setback" | "unclear";
  vehicleAccess: "adjacent" | "nearby" | "restricted" | "unclear";
  parkingRestriction:
    | "none_visible"
    | "single_yellow"
    | "double_yellow"
    | "permit_zone"
    | "unclear";
  sideAccess: "clear" | "narrow" | "none_visible" | "unclear";
  obstructions: Array<
    "mature_trees" | "conservatory" | "power_lines" | "steep_ground" | "outbuilding"
  >;
  imageryUsable: boolean;
  imageryYear: number | null;
  summary: string;
  confidence: Record<string, number>;
};

type LatLng = { lat: number; lng: number };

const GEMINI_MODEL = "gemini-2.0-flash";

/**
 * Bump when the prompt or the schema changes.
 *
 * It is part of the cache key, so a prompt edit invalidates old answers instead
 * of serving observations produced by rules that no longer exist. Without this
 * a tweak to the wording would silently apply to new addresses only, and the
 * two populations would price differently forever.
 */
export const PROMPT_VERSION = 1;

/**
 * What the model is asked. Kept deliberately narrow and physical.
 *
 * It is told what the answers are FOR, because a model that knows it is helping
 * price scaffolding reads a kerb differently from one asked to describe a
 * photo. It is also told, repeatedly, to prefer "unclear" — a model pushed to
 * choose will confabulate, and a confident wrong answer is far more expensive
 * here than an honest shrug, since only confident answers reach the price.
 */
function buildPrompt(): string {
  return `You are helping a UK roofing company work out how hard it will be to get
scaffolding to a property. You are looking at two images of the same address:
the first is street-level, the second is directly overhead.

Report ONLY what you can actually see. This is used to price real work, so a
confident wrong answer costs a homeowner money. Whenever you are not sure, say
"unclear" and give a low confidence — that is a useful answer here, not a
failure.

Judge these:

- frontage: does the building front straight onto the pavement/footway
  ("on_pavement"), sit behind a small garden or wall ("small_setback"), or sit
  behind its own driveway or off-street parking ("driveway_setback")?
- vehicleAccess: could a scaffolding lorry stop directly outside ("adjacent"),
  close by ("nearby"), or not realistically at all — pedestrianised, very
  narrow, blocked ("restricted")?
- parkingRestriction: any visible double yellow lines, single yellow,
  resident-permit signage, or nothing visible?
- sideAccess: is there a visible gate, alley or path wide enough to carry
  scaffold poles to the rear ("clear"), a tight squeeze ("narrow"), or no route
  at all without going through the house ("none_visible")?
- obstructions: mature trees, a conservatory, overhead power lines, steeply
  sloping ground, or outbuildings close to the walls.

Also set imageryUsable to false if the street image does not actually show a
building — some addresses have no coverage, or the camera is facing a hedge or
open road.

summary: one plain sentence a roofer would find useful, no jargon.

confidence: a number 0-1 for each of frontage, vehicleAccess,
parkingRestriction and sideAccess, reflecting how clearly you could actually
see it. Be strict. Anything you inferred rather than saw should be below 0.7.`;
}

/** Gemini's structured-output schema. Constrains the model to valid enums. */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    frontage: {
      type: "string",
      enum: ["on_pavement", "small_setback", "driveway_setback", "unclear"],
    },
    vehicleAccess: {
      type: "string",
      enum: ["adjacent", "nearby", "restricted", "unclear"],
    },
    parkingRestriction: {
      type: "string",
      enum: [
        "none_visible",
        "single_yellow",
        "double_yellow",
        "permit_zone",
        "unclear",
      ],
    },
    sideAccess: {
      type: "string",
      enum: ["clear", "narrow", "none_visible", "unclear"],
    },
    obstructions: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "mature_trees",
          "conservatory",
          "power_lines",
          "steep_ground",
          "outbuilding",
        ],
      },
    },
    imageryUsable: { type: "boolean" },
    summary: { type: "string" },
    confidence: {
      type: "object",
      properties: {
        frontage: { type: "number" },
        vehicleAccess: { type: "number" },
        parkingRestriction: { type: "number" },
        sideAccess: { type: "number" },
      },
    },
  },
  required: [
    "frontage",
    "vehicleAccess",
    "parkingRestriction",
    "sideAccess",
    "obstructions",
    "imageryUsable",
    "summary",
    "confidence",
  ],
} as const;

/** Every failure resolves to this rather than throwing. A quote must never fail
 *  because a nice-to-have could not see a house. */
export function unusable(): SiteObservation {
  return {
    frontage: "unclear",
    vehicleAccess: "unclear",
    parkingRestriction: "unclear",
    sideAccess: "unclear",
    obstructions: [],
    imageryUsable: false,
    imageryYear: null,
    summary: "",
    confidence: {},
  };
}

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Compass bearing from camera to house, degrees clockwise from north. */
function bearing(from: LatLng, to: LatLng): number {
  const p1 = rad(from.lat);
  const p2 = rad(to.lat);
  const dl = rad(to.lng - from.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

function distanceM(a: LatLng, b: LatLng): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = p2 - p1;
  const dl = rad(b.lng - a.lng);
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Past this the nearest panorama is not showing the property at all — a private
 * drive, a new estate, a rear service lane. Asking a vision model to assess
 * site access from a photograph of a different street is worse than not asking:
 * it returns confident observations about the wrong house, and those go on to
 * move a price.
 */
const MAX_CAMERA_DISTANCE_M = 60;

/**
 * Metadata is a separate SKU with unlimited free usage (3168-48A9-5C8C), so this
 * costs nothing and answers three things before any billable request: whether
 * coverage exists, which exact panorama, and where its camera stands.
 *
 * That last one is what makes the imagery usable. Requesting by location snaps
 * to the nearest panorama and then faces wherever the camera van was pointing,
 * so without a computed heading the model is routinely shown a neighbour or a
 * hedge. Measured on a real lead: camera 25m away, needed 263 degrees.
 */
async function streetViewMeta(
  coords: LatLng,
  key: string,
): Promise<{
  ok: boolean;
  year: number | null;
  panoId: string | null;
  heading: number | null;
}> {
  const miss = { ok: false, year: null, panoId: null, heading: null };
  try {
    const url =
      `https://maps.googleapis.com/maps/api/streetview/metadata` +
      `?location=${coords.lat},${coords.lng}&source=outdoor&key=${key}`;
    const r = await loggedFetch("streetview-meta", url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const d = (await r.json()) as {
      status?: string;
      date?: string;
      pano_id?: string;
      location?: LatLng;
    };
    if (d.status !== "OK" || !d.pano_id || !d.location) return miss;
    if (distanceM(d.location, coords) > MAX_CAMERA_DISTANCE_M) return miss;

    const year = d.date ? Number(d.date.slice(0, 4)) : null;
    return {
      ok: true,
      year: Number.isFinite(year) ? year : null,
      panoId: d.pano_id,
      heading: bearing(d.location, coords),
    };
  } catch {
    return miss;
  }
}

async function fetchImageBase64(
  url: string,
  label: string,
): Promise<string | null> {
  try {
    const r = await loggedFetch(label, url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return Buffer.from(buf).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Observe a site. Returns `unusable()` on any failure — never throws.
 *
 * Images are sent to Gemini and not retained. Only the resulting observations
 * are stored, alongside the coordinates needed to re-fetch. That is partly
 * Google's terms, which restrict caching Maps imagery, and partly that a
 * permanent archive of photographs of people's houses is not a thing to build
 * without deciding to.
 */
export async function observeSite(
  coords: LatLng,
  opts: { mapsKey: string; geminiKey: string },
): Promise<SiteObservation> {
  const meta = await streetViewMeta(coords, opts.mapsKey);
  if (!meta.ok) return unusable();

  // By pano id and computed heading, not by location — see streetViewMeta.
  // Pinning the panorama also means it cannot re-snap to a different one later.
  const streetUrl =
    `https://maps.googleapis.com/maps/api/streetview` +
    `?size=640x400&pano=${meta.panoId}&heading=${meta.heading!.toFixed(1)}` +
    `&fov=70&pitch=10&return_error_code=true&key=${opts.mapsKey}`;
  const aerialUrl =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${coords.lat},${coords.lng}&zoom=19&size=640x400` +
    `&maptype=satellite&key=${opts.mapsKey}`;

  const [street, aerial] = await Promise.all([
    fetchImageBase64(streetUrl, "streetview-image"),
    fetchImageBase64(aerialUrl, "staticmap-image"),
  ]);
  // The street image is the one that carries the access signal. Without it
  // there is nothing worth asking about, and the aerial alone would invite the
  // model to guess at things it cannot see.
  if (!street) return unusable();

  const parts: unknown[] = [
    { text: buildPrompt() },
    { inline_data: { mime_type: "image/jpeg", data: street } },
  ];
  if (aerial) {
    parts.push({ inline_data: { mime_type: "image/png", data: aerial } });
  }

  try {
    const r = await loggedFetch(
      "gemini-site",
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": opts.geminiKey,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            // Deterministic: the same house must not score differently on a
            // refresh, or two identical quotes disagree.
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!r.ok) return unusable();
    const body = (await r.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return unusable();

    const parsed = JSON.parse(text) as Partial<SiteObservation>;
    return {
      ...unusable(),
      ...parsed,
      // The model is not asked for this — it is a fact about the photograph,
      // not a judgement, so it comes from the metadata call.
      imageryYear: meta.year,
      imageryUsable: parsed.imageryUsable !== false,
      obstructions: Array.isArray(parsed.obstructions) ? parsed.obstructions : [],
      confidence:
        parsed.confidence && typeof parsed.confidence === "object"
          ? parsed.confidence
          : {},
    };
  } catch {
    return unusable();
  }
}
