/**
 * Storage for customer-supplied damage photos.
 *
 * These are pictures of a private individual's home, uploaded before the lead
 * row exists, so two things matter more than they would for ordinary assets:
 *
 *  - The bucket is PRIVATE. Reads go through short-lived signed URLs issued by
 *    the dashboard, never a public URL. The storage RLS policy must mirror the
 *    `leads` policy (is_roofer_member) or one roofer can read another's
 *    customer photos — see the migration in the dashboard repo.
 *  - Paths are scoped by roofer id first, so a policy can match on the leading
 *    path segment.
 *
 * Uploads are best-effort in the same sense as the rest of the lead pipeline:
 * a storage failure returns fewer paths, never an error to the customer.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { redact } from "@/lib/logged-fetch";

export const LEAD_PHOTO_BUCKET = "lead-photos";

export type StoredPhoto = { path: string };

/**
 * Upload one batch of photos under `{rooferId}/{submissionId}/{n}.jpg`.
 *
 * Keyed on the widget's submission id rather than the lead id because the
 * photos are graded *before* the lead is created — the customer is still on
 * the photo step and has not given their contact details yet.
 */
export async function storeLeadPhotos(
  rooferId: string,
  submissionId: string,
  photos: { buffer: ArrayBuffer; mimeType: string }[],
): Promise<string[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const safeRoofer = sanitiseSegment(rooferId);
  const safeSubmission = sanitiseSegment(submissionId);
  if (!safeRoofer || !safeSubmission) return [];

  const paths: string[] = [];
  for (const [index, photo] of photos.entries()) {
    const extension = photo.mimeType === "image/png" ? "png" : "jpg";
    const path = `${safeRoofer}/${safeSubmission}/${index + 1}.${extension}`;
    try {
      const { error } = await supabase.storage
        .from(LEAD_PHOTO_BUCKET)
        .upload(path, photo.buffer, {
          contentType: photo.mimeType,
          upsert: true,
        });
      if (error) {
        console.error("Lead photo upload failed:", redact(error));
        continue;
      }
      paths.push(path);
    } catch (error) {
      console.error("Lead photo upload threw:", redact(error));
    }
  }
  return paths;
}

/**
 * Strip anything that could escape the intended prefix. Storage keys are not
 * filesystem paths, but `..` and slashes would still let a crafted id write
 * outside its own folder and defeat the RLS prefix match.
 */
function sanitiseSegment(value: string): string | null {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned.length > 0 && cleaned.length <= 64 ? cleaned : null;
}
