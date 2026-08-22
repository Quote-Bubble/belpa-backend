/**
 * POST /api/severity — grade customer damage photos 1-5.
 *
 * Called from the widget's photo step, before the lead exists. Accepts
 * multipart/form-data because the JSON path caps bodies at 64 KB
 * (lib/validate.ts), which is two orders of magnitude below a phone photo.
 * `multipart/form-data` is a CORS-safelisted content-type, so this needs no
 * change to the preflight allow-headers.
 *
 * Failure is always soft. Every error path returns 200 with `severity: null`,
 * which the widget treats as "customer skipped photos" — the estimate is then
 * byte-identical to what it would have been. The only hard rejections are
 * abuse-shaped: too many files, oversized files, or no rate limiter in prod.
 */
import { preflight, withCors } from "@/lib/cors";
import { storeLeadPhotos } from "@/lib/lead-photos";
import { isRateLimitConfigured, limitOr429 } from "@/lib/rate-limit";
import { gradeSeverity, type SeverityPhoto } from "@/lib/severity";
import { isSeverityJobType } from "@/lib/severity-prompt";

import { NextResponse } from "next/server";

import type { JobType } from "@/lib/types";

/** Vision grading is slower than the geocoding hops (which use 12-15s). */
export const maxDuration = 30;

const MAX_PHOTOS = 5;
const MAX_BYTES_PER_PHOTO = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

type SeverityResponse = {
  severity: number | null;
  confidence: "medium" | "high" | null;
  visibleIssues: string[];
  photoPaths: string[];
};

const EMPTY: SeverityResponse = {
  severity: null,
  confidence: null,
  visibleIssues: [],
  photoPaths: [],
};

async function handlePost(request: Request): Promise<NextResponse> {
  // Fail CLOSED without a limiter. limitOr429 skips silently when Redis is
  // unset, which is fine for geocoding but not for a route that spends money
  // per call. Allowed in dev so the flow is testable without Upstash.
  if (!isRateLimitConfigured() && process.env.NODE_ENV === "production") {
    console.error("Severity route blocked: no rate limiter configured.");
    return NextResponse.json(EMPTY, { status: 200 });
  }

  const limited = await limitOr429(request, "severity");
  if (limited) return limited;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const jobTypeRaw = String(form.get("jobType") ?? "");
  if (!isSeverityJobType(jobTypeRaw as JobType)) {
    return NextResponse.json({ error: "Unsupported job type." }, { status: 400 });
  }
  const jobType = jobTypeRaw as Parameters<typeof gradeSeverity>[1];

  const rooferId = String(form.get("rooferId") ?? "").trim();
  const submissionId = String(form.get("submissionId") ?? "").trim();
  if (!rooferId || !submissionId) {
    return NextResponse.json({ error: "Missing identifiers." }, { status: 400 });
  }

  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json(EMPTY, { status: 200 });
  if (files.length > MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Please attach no more than ${MAX_PHOTOS} photos.` },
      { status: 400 },
    );
  }

  // Validate everything before spending a byte upstream.
  for (const file of files) {
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: "Photos must be JPEG, PNG or WebP." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES_PER_PHOTO) {
      return NextResponse.json(
        { error: "Each photo must be under 2MB." },
        { status: 400 },
      );
    }
  }

  const buffers = await Promise.all(
    files.map(async (file) => ({
      buffer: await file.arrayBuffer(),
      mimeType: file.type,
    })),
  );

  const forGrading: SeverityPhoto[] = buffers.map((b) => ({
    mimeType: b.mimeType,
    base64: Buffer.from(b.buffer).toString("base64"),
  }));

  // Grade and store concurrently — neither depends on the other, and the
  // customer is waiting on this call.
  const [severity, photoPaths] = await Promise.all([
    gradeSeverity(forGrading, jobType),
    storeLeadPhotos(rooferId, submissionId, buffers),
  ]);

  return NextResponse.json(
    {
      severity: severity?.score ?? null,
      confidence: severity?.confidence ?? null,
      visibleIssues: severity?.visibleIssues ?? [],
      photoPaths,
    } satisfies SeverityResponse,
    { status: 200 },
  );
}

export const POST = withCors(handlePost);
export const OPTIONS = preflight;
