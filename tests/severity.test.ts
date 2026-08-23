import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calibrateScore,
  gradeSeverity,
  parseSeverityResponse,
  resetGeminiConfigCache,
} from "@/lib/severity";
import { buildSeverityPrompt, isSeverityJobType } from "@/lib/severity-prompt";

function geminiResponse(payload: unknown) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200 },
  );
}

function calledHosts(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map(([input]) => String(input))
    .map((u) =>
      u.includes("generativelanguage.googleapis.com") ? "gemini" : u,
    );
}

const PHOTOS = [{ mimeType: "image/jpeg", base64: "AAAA" }];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  process.env.GEMINI_API_KEY = "test-key";
  resetGeminiConfigCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GEMINI_API_KEY;
  resetGeminiConfigCache();
});

describe("parseSeverityResponse", () => {
  it("accepts a well-formed medium/high verdict", () => {
    const parsed = parseSeverityResponse({
      severity: 3,
      confidence: "high",
      visibleIssues: ["two slipped tiles"],
      rationale: "…",
    });
    // Parsing applies the calibration, so a raw 3 lands at 2 — "two slipped
    // tiles" is the textbook minor defect the model was over-grading.
    expect(parsed).toMatchObject({
      score: 2,
      confidence: "high",
      visibleIssues: ["two slipped tiles"],
    });
  });

  it("discards a low-confidence verdict entirely", () => {
    // The guard that stops a dark or out-of-scope photo moving a real price.
    expect(
      parseSeverityResponse({
        severity: 5,
        confidence: "low",
        visibleIssues: [],
        rationale: "…",
      }),
    ).toBeNull();
  });

  it("rejects out-of-range and malformed scores", () => {
    for (const bad of [
      { severity: 0, confidence: "high" },
      { severity: 6, confidence: "high" },
      { severity: "3", confidence: "high" },
      { severity: 3, confidence: "wat" },
      null,
      "nope",
    ]) {
      expect(parseSeverityResponse(bad)).toBeNull();
    }
  });

  it("caps runaway visibleIssues rather than trusting the model", () => {
    const parsed = parseSeverityResponse({
      severity: 2,
      confidence: "medium",
      visibleIssues: Array.from({ length: 40 }, () => "x".repeat(500)),
      rationale: "…",
    });
    expect(parsed?.visibleIssues).toHaveLength(8);
    expect(parsed?.visibleIssues[0]?.length).toBe(200);
  });
});

describe("calibrateScore", () => {
  it("clamps into 1-5", () => {
    expect(calibrateScore(-4)).toBe(1);
    expect(calibrateScore(99)).toBe(5);
  });

  it("corrects the measured over-scoring in the 3-5 range only", () => {
    // If this fails, someone changed SEVERITY_CALIBRATION_OFFSET or the floor —
    // that is a pricing change and needs the bake-off rerun, not just a test
    // update. The model was measured grading +0.60 above a human reference and
    // never below, so minor defects are left alone and the crowded middle comes
    // down one band.
    expect([1, 2, 3, 4, 5].map(calibrateScore)).toEqual([1, 2, 2, 3, 4]);
  });

  it("never demotes a minor defect to negligible", () => {
    // The one direction the model was never wrong in. A 2 that becomes a 1
    // would tell a roofer there is nothing to look at.
    expect(calibrateScore(2)).toBe(2);
  });
});

describe("gradeSeverity", () => {
  it("returns a score and calls Gemini exactly once", async () => {
    vi.mocked(fetch).mockResolvedValue(
      geminiResponse({
        severity: 4,
        confidence: "high",
        visibleIssues: ["underlay visible"],
        rationale: "…",
      }),
    );

    const result = await gradeSeverity(PHOTOS, "tile_or_slate_repair");
    // Raw 4 from Gemini, calibrated down one band on the way out.
    expect(result).toMatchObject({ score: 3, confidence: "high" });
    expect(calledHosts()).toEqual(["gemini"]);
  });

  it("returns null without calling Gemini when no API key is set", async () => {
    delete process.env.GEMINI_API_KEY;
    resetGeminiConfigCache();

    expect(await gradeSeverity(PHOTOS, "gutter_clearing")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null without calling Gemini when there are no photos", async () => {
    expect(await gradeSeverity([], "tile_or_slate_repair")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("degrades to null on an upstream error rather than throwing", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await gradeSeverity(PHOTOS, "tile_or_slate_repair")).toBeNull();
  });

  it("degrades to null on a network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNRESET"));
    expect(await gradeSeverity(PHOTOS, "tile_or_slate_repair")).toBeNull();
  });

  it("degrades to null on an unparseable body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    expect(await gradeSeverity(PHOTOS, "tile_or_slate_repair")).toBeNull();
  });

  it("sends every photo in one request, not one call each", async () => {
    vi.mocked(fetch).mockResolvedValue(
      geminiResponse({
        severity: 2,
        confidence: "medium",
        visibleIssues: [],
        rationale: "…",
      }),
    );

    await gradeSeverity(
      Array.from({ length: 5 }, () => ({ mimeType: "image/jpeg", base64: "A" })),
      "gutters_fascias_soffits",
    );

    expect(calledHosts()).toEqual(["gemini"]);
    const body = JSON.parse(
      String(vi.mocked(fetch).mock.calls[0]?.[1]?.body ?? "{}"),
    );
    const parts = body.contents[0].parts;
    expect(parts.filter((p: unknown) => (p as { inline_data?: unknown }).inline_data)).toHaveLength(5);
    expect(body.generationConfig.temperature).toBe(0);
  });
});

describe("severity prompt", () => {
  it("only recognises the three no-area job types", () => {
    expect(isSeverityJobType("tile_or_slate_repair")).toBe(true);
    expect(isSeverityJobType("gutters_fascias_soffits")).toBe(true);
    expect(isSeverityJobType("gutter_clearing")).toBe(true);
    expect(isSeverityJobType("full_replacement")).toBe(false);
    expect(isSeverityJobType("roof_soft_wash")).toBe(false);
    expect(isSeverityJobType("leak_investigation")).toBe(false);
  });

  it("keeps the guardrails the bake-off proved were load-bearing", () => {
    const prompt = buildSeverityPrompt("tile_or_slate_repair");
    // v2 of this prompt lost the derelict clause and started grading a
    // roofless ruin as severity 5 at high confidence.
    expect(prompt).toContain("derelict");
    expect(prompt).toContain("When in doubt, low.");
    // Removing the diagnosis ban would contradict the cited UK guidance that
    // leaks cannot be diagnosed from photographs.
    expect(prompt).toContain("Do NOT diagnose causes");
    expect(prompt).toContain("age and appearance are NOT severity");
  });

  it("uses job-specific criteria", () => {
    expect(buildSeverityPrompt("gutter_clearing")).toContain("debris fill");
    expect(buildSeverityPrompt("gutters_fascias_soffits")).toContain("fascia");
    expect(buildSeverityPrompt("tile_or_slate_repair")).toContain("battens");
  });
});
