import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limitState = vi.hoisted(() => ({ configured: true }));

vi.mock("@/lib/rate-limit", () => ({
  limitOr429: vi.fn(async () => null),
  isRateLimitConfigured: vi.fn(() => limitState.configured),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  clientIp: () => "127.0.0.1",
  resetRateLimitCache: vi.fn(),
}));

// Storage is exercised in isolation elsewhere; here it must simply not be the
// reason a grading request fails.
vi.mock("@/lib/lead-photos", () => ({
  storeLeadPhotos: vi.fn(async () => ["roofer/sub/1.jpg"]),
  LEAD_PHOTO_BUCKET: "lead-photos",
}));

import { POST } from "@/app/api/severity/route";
import { resetGeminiConfigCache } from "@/lib/severity";

function jpeg(bytes = 32): File {
  return new File([new Uint8Array(bytes)], "damage.jpg", { type: "image/jpeg" });
}

function formRequest(
  files: File[],
  fields: Record<string, string> = {},
): Request {
  const form = new FormData();
  form.set("jobType", fields.jobType ?? "tile_or_slate_repair");
  form.set("rooferId", fields.rooferId ?? "belpa-demo");
  form.set("submissionId", fields.submissionId ?? "sub-123");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const f of files) form.append("photos", f);
  return new Request("http://localhost/api/severity", {
    method: "POST",
    body: form,
  });
}

function geminiOk(severity: number, confidence = "high") {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  severity,
                  confidence,
                  visibleIssues: ["two slipped tiles"],
                  rationale: "…",
                }),
              },
            ],
          },
        },
      ],
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  process.env.GEMINI_API_KEY = "test-key";
  limitState.configured = true;
  resetGeminiConfigCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GEMINI_API_KEY;
  vi.unstubAllEnvs();
  resetGeminiConfigCache();
});

describe("POST /api/severity", () => {
  it("grades a valid submission", async () => {
    vi.mocked(fetch).mockResolvedValue(geminiOk(3));

    const response = await POST(formRequest([jpeg()]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      severity: 3,
      confidence: "high",
      photoPaths: ["roofer/sub/1.jpg"],
    });
  });

  it("returns a null severity, not an error, when Gemini fails", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("boom", { status: 500 }));

    const response = await POST(formRequest([jpeg()]));
    const body = await response.json();

    // The customer must still get their estimate.
    expect(response.status).toBe(200);
    expect(body.severity).toBeNull();
  });

  it("returns a null severity when the grader is unsure", async () => {
    vi.mocked(fetch).mockResolvedValue(geminiOk(5, "low"));

    const body = await (await POST(formRequest([jpeg()]))).json();
    expect(body.severity).toBeNull();
    expect(body.confidence).toBeNull();
  });

  it("rejects more than five photos", async () => {
    const response = await POST(
      formRequest(Array.from({ length: 6 }, () => jpeg())),
    );
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an oversized photo before spending upstream quota", async () => {
    const response = await POST(formRequest([jpeg(2 * 1024 * 1024 + 1)]));
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-image upload", async () => {
    const pdf = new File([new Uint8Array(16)], "x.pdf", {
      type: "application/pdf",
    });
    const response = await POST(formRequest([pdf]));
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a job type that does not offer photos", async () => {
    const response = await POST(
      formRequest([jpeg()], { jobType: "full_replacement" }),
    );
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns empty without calling Gemini when no photos are attached", async () => {
    const response = await POST(formRequest([]));
    expect(response.status).toBe(200);
    expect((await response.json()).severity).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed in production when no rate limiter is configured", async () => {
    // This route spends money per call, so the fail-open default that suits
    // geocoding is wrong here.
    limitState.configured = false;
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(formRequest([jpeg()]));
    expect(response.status).toBe(200);
    expect((await response.json()).severity).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still runs without a limiter outside production", async () => {
    limitState.configured = false;
    vi.stubEnv("NODE_ENV", "development");
    vi.mocked(fetch).mockResolvedValue(geminiOk(2));

    const body = await (await POST(formRequest([jpeg()]))).json();
    expect(body.severity).toBe(2);
  });
});
