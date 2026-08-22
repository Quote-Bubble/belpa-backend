/**
 * Gemini-backed damage severity grading.
 *
 * Every failure mode here is deliberately soft: no API key, a timeout, a
 * malformed response, or a low-confidence verdict all resolve to `null`, and a
 * null severity means the estimate is exactly what it would have been with no
 * photos at all. Nothing in this module is allowed to fail a customer's quote.
 */
import * as Sentry from "@sentry/nextjs";

import { loggedFetch, redact } from "@/lib/logged-fetch";
import {
  SEVERITY_RESPONSE_SCHEMA,
  buildSeverityPrompt,
  type SeverityJobType,
} from "@/lib/severity-prompt";
import type { DamageSeverity } from "@/lib/types";

/**
 * Chosen by measured bake-off against gemini-3.7-flash, not by reputation:
 * identical accuracy (MAE 0.60 vs 0.80 against a human reference), but
 * perfectly deterministic across repeats where 3.7-flash disagreed with itself
 * on 3 of 10 images. A grader that returns 3 then 4 for the same photo moves a
 * customer's price for no reason. It is also ~5x cheaper.
 *
 * Note there is no "gemini-3.1-flash" — the 3.1-branded Flash models are
 * -flash-lite, -flash-image and -flash-live-preview. Verified against
 * GET /v1beta/models, not just the docs.
 */
const MODEL = "gemini-3.1-flash-lite";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Vision calls are slower than the geocoding hops; well under maxDuration. */
const TIMEOUT_MS = 20_000;

/**
 * The bake-off measured this model grading +0.60 severity points above a human
 * reference across 10 images, never below — it reads weathering as damage.
 * That is a real, consistent bias, but ten images and a single grader is not
 * enough evidence to fix its magnitude, so the correction ships at zero and
 * lives here as one named constant rather than buried in the pricing formula.
 *
 * Calibrate against leads.actual_price_ex_vat once ~50 severity-scored jobs
 * have closed; the dashboard already computes won-price variance vs estimate.
 */
export const SEVERITY_CALIBRATION_OFFSET = 0;

type GeminiConfig = { ok: true; apiKey: string } | { ok: false };

let cachedConfig: GeminiConfig | undefined;
let warnedMissingKey = false;

export function getGeminiConfig(): GeminiConfig {
  if (cachedConfig !== undefined) return cachedConfig;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        "GEMINI_API_KEY not configured; photo severity grading is disabled.",
      );
    }
    cachedConfig = { ok: false };
    return cachedConfig;
  }

  cachedConfig = { ok: true, apiKey };
  return cachedConfig;
}

/** Test helper — clears the memoized config between cases. */
export function resetGeminiConfigCache(): void {
  cachedConfig = undefined;
  warnedMissingKey = false;
}

export type SeverityPhoto = { mimeType: string; base64: string };

/**
 * Applies the calibration offset and clamps back into 1-5. Kept separate from
 * the transport so it can be unit-tested without a network mock.
 */
export function calibrateScore(raw: number): 1 | 2 | 3 | 4 | 5 {
  const shifted = Math.round(raw - SEVERITY_CALIBRATION_OFFSET);
  return Math.min(5, Math.max(1, shifted)) as 1 | 2 | 3 | 4 | 5;
}

/**
 * Narrow an untrusted Gemini payload to a DamageSeverity, or null.
 *
 * Returns null for low confidence by design: DamageSeverity's `confidence`
 * field cannot express "low", so a low verdict cannot reach the pricing engine
 * even if a later caller forgets to check.
 */
export function parseSeverityResponse(value: unknown): DamageSeverity | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  const score = typeof v.severity === "number" ? v.severity : NaN;
  if (!Number.isFinite(score) || score < 1 || score > 5) return null;

  const confidence = v.confidence;
  if (confidence !== "medium" && confidence !== "high") return null;

  const visibleIssues = Array.isArray(v.visibleIssues)
    ? v.visibleIssues
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.slice(0, 200))
        .slice(0, 8)
    : [];

  return {
    score: calibrateScore(score),
    confidence,
    visibleIssues,
    model: MODEL,
  };
}

/**
 * Grade a set of photos as one batch — the worst visible area drives the score,
 * so grading them individually and taking a max would both cost more and lose
 * the cross-photo context.
 *
 * Never throws. Returns null whenever a score cannot be trusted.
 */
export async function gradeSeverity(
  photos: SeverityPhoto[],
  jobType: SeverityJobType,
): Promise<DamageSeverity | null> {
  if (photos.length === 0) return null;

  const config = getGeminiConfig();
  if (!config.ok) return null;

  const url = `${ENDPOINT}/${MODEL}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  try {
    const response = await loggedFetch("gemini-severity", url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: buildSeverityPrompt(jobType) },
              ...photos.map((p) => ({
                inline_data: { mime_type: p.mimeType, data: p.base64 },
              })),
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: SEVERITY_RESPONSE_SCHEMA,
          // Deterministic: the same photos must always yield the same price.
          temperature: 0,
        },
      }),
    });

    if (!response.ok) {
      console.warn(`Gemini severity grading failed: ${response.status}`);
      return null;
    }

    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    return parseSeverityResponse(JSON.parse(text));
  } catch (error) {
    // A grading failure must never surface to the customer — they simply get
    // the same estimate they would have had without photos.
    console.error("Gemini severity grading error:", redact(error));
    Sentry.captureException(error, { tags: { stage: "severity-grading" } });
    return null;
  }
}
