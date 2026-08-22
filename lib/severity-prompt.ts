/**
 * The grading prompt for photo-derived damage severity.
 *
 * This wording is not arbitrary — it is the third iteration from a measured
 * bake-off (10 photos, 3 repeats, temperature 0, both candidate models). The
 * two earlier drafts are worth knowing about before editing:
 *
 *   v1  MAE 0.70, bias +0.70, 3/4 adversarial photos correctly refused.
 *   v2  Added the CALIBRATION block. Accuracy improved (MAE 0.60) but a
 *       roofless ruin flipped from "low confidence" to "severity 5, high
 *       confidence" — because v2 also invited the model to *justify* a high
 *       score, which it duly did. Adversarial dropped to 2/4.
 *   v3  Keeps the calibration, replaces the justification invitation with a
 *       burden-of-proof framing, and adds the derelict-building clause.
 *       MAE 0.60, bias +0.60, 3/4 adversarial, zero variance across repeats.
 *
 * The lesson from v2: any instruction that asks the model to explain a high
 * score makes high scores more likely. Re-run the bake-off after editing.
 *
 * Known residual weakness: dark or backlit photos are still graded rather than
 * refused (bake-off image 06). The guard catches "no roof", "ruin" and "new
 * construction" but not "technically a roof, too dark to actually assess".
 */
import type { JobType } from "@/lib/types";

/** The only job types that offer the photo step — see PHOTO_JOB_TYPES. */
export type SeverityJobType =
  | "tile_or_slate_repair"
  | "gutters_fascias_soffits"
  | "gutter_clearing";

export const SEVERITY_JOB_TYPES: SeverityJobType[] = [
  "tile_or_slate_repair",
  "gutters_fascias_soffits",
  "gutter_clearing",
];

export function isSeverityJobType(value: JobType): value is SeverityJobType {
  return (SEVERITY_JOB_TYPES as JobType[]).includes(value);
}

/**
 * What to actually look at, per job type. Each list is ordered with the
 * strongest cost escalator first, because that is what should dominate the
 * score — see the plan's citations for why exposed substrate (tiles) and
 * fascia rot (roofline) carry the most weight.
 */
const JOB_CRITERIA: Record<SeverityJobType, string> = {
  tile_or_slate_repair: `Grade what is visible on the tiled or slated roof covering:
- how many units are slipped, cracked, missing or delaminating
- whether underlay, battens or bare timber are visible through any gap (this is the
  single strongest escalator: exposed substrate predicts hidden batten/felt rot)
- whether ridge, hip or valley details are disturbed
- staining, moss or vegetation indicating a long-standing water path
- any sagging or deflection of the roof plane`,

  gutters_fascias_soffits: `Grade what is visible on the guttering and roofline:
- whether the failure is at a single joint (cheap) or along a whole run (expensive)
- sag, standing water, or a section dropped below its intended fall
- brackets rusted, loose or detached
- rot, staining or paint failure on the fascia or soffit timber (strongest escalator:
  it converts a gutter job into a roofline job)
- vegetation growing in the run
- water staining down the wall below the gutter line`,

  gutter_clearing: `Grade what is visible of the gutter blockage:
- depth of debris fill relative to the gutter profile
- established vegetation or saplings rooted in the run
- a consolidated moss mat versus loose leaf litter
- overflow staining on the wall or fascia below`,
};

export function buildSeverityPrompt(jobType: SeverityJobType): string {
  return `You are grading the SEVERITY of a visible roofing defect from customer-supplied
photographs, for a UK roofing company's instant estimate tool.

Anchor your score to the RICS Home Survey condition ratings:
  1 = RICS CR1. Cosmetic or negligible. No exposed substrate, no water path.
  2 = CR1/CR2 boundary. Minor, isolated, under 20% of the visible element. Still serviceable.
  3 = RICS CR2. A clear defect needing repair, roughly 20-50% of the element affected,
      not urgent, no evidence of active water ingress.
  4 = CR2/CR3 boundary. Extensive (over 50%), OR an active water path, OR substrate exposed.
  5 = RICS CR3. Serious and/or urgent - structural movement, collapse, active ingress,
      or a safety risk.

CALIBRATION - this is the most common way to get this wrong:
Most photographs a homeowner sends of a repair they want quoted are a 2 or a 3.
A roof can look old, weathered, stained, lichen-covered or patched and still be
a 2 - age and appearance are NOT severity. Score on the DEFECT, not on how tired
the roof looks. Reserve 4 for damage that is genuinely extensive or has an active
water path, and 5 only for a genuine emergency: collapse, structural movement, or
a hole open to the sky. Scoring 4 or 5 is a strong claim - the burden of proof is on
the photograph, not on your reading of it.

The job type is: ${jobType}
${JOB_CRITERIA[jobType]}

CRITICAL RULES:
- Grade ONLY what is visibly evident. Do NOT diagnose causes. Water travels far from
  where it enters a roof, so you cannot infer the source of a leak from a photograph.
- Return confidence "low" if ANY of these hold: the photographs are dark, backlit or
  underexposed such that detail in the shadowed area is lost; blurry; too distant for you
  to count individual damaged units; the defect occupies less than roughly 5% of the frame;
  they do not show a roof or gutter at all; they show a building with no roof remaining; or
  they show new or in-progress construction work rather than a defect.
  ALSO return low, regardless of how severe the damage looks, if the building is derelict,
  ruined, abandoned or has no roof remaining: that is not a repair a homeowner is buying,
  so there is no estimate to adjust. A dramatic photograph is not a confident one.
  When in doubt, low.
- Judge the set as a whole. The worst clearly-visible area drives the score.

Return ONLY JSON.`;
}

/** Forced-JSON schema. Mirrored by parseSeverityResponse in lib/severity.ts. */
export const SEVERITY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    severity: { type: "integer", minimum: 1, maximum: 5 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    visibleIssues: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
  required: ["severity", "confidence", "visibleIssues", "rationale"],
} as const;
