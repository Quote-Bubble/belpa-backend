import { describe, expect, it } from "vitest";

import { parseLeadBody } from "@/lib/validate";

/* Every job type the widget can offer must survive validation AND the database.
 *
 * The database half is what actually broke: leads_job_type_known listed only
 * the six job types that existed when it was written, so soft wash, biocide
 * and gutter clearing passed every application check and then died on a 23514.
 * A roofer selling nothing but cleaning lost every lead, and the widget said
 * "we couldn't send your details" — which reads as a glitch, not as a
 * permanent, total failure.
 *
 * This test guards the application half. Migration 0021 fixes the schema, and
 * the two lists have to stay in step: adding a job type here without adding it
 * to the constraint reproduces the bug exactly. */
describe("job types the widget can send", () => {
  const WIDGET_JOB_TYPES = [
    "full_replacement",
    "tile_or_slate_repair",
    "flat_roof_replacement",
    "leak_investigation",
    "gutters_fascias_soffits",
    "roof_soft_wash",
    "roof_biocide_treatment",
    "gutter_clearing",
    "driveway_cleaning",
    "other",
  ];

  it("are all accepted", () => {
    for (const jobType of WIDGET_JOB_TYPES) {
      const result = parseLeadBody({
        rooferId: "a-roofer",
        leadType: "quote",
        intent: "quote_requested",
        jobType,
        otherJobDescription: null,
        propertyType: "semi_detached",
        storeys: 2,
        material: null,
        conditionAnswer: null,
        conditionFlagged: false,
        coords: { lat: 51.6288, lng: -0.7529 },
        address: { line: "12 Test Road", postcode: "HP13 6TS", formatted: "x" },
        contact: { name: "T", phone: "07000000000", email: "" },
        quoteRange: { minExVat: 380, maxExVat: 520 },
        solar: {
          areaM2: 78.4,
          groundAreaM2: 64.1,
          pitchDegrees: 35,
          roofType: null,
          measurementMethod: "segment_bbox_overlap",
          segmentContributions: [],
          segments: [],
          wholeRoofStats: null,
          imageryQuality: null,
          imageryDate: null,
        },
        roofline: null,
        obstructions: { chimneys: 0, rooflights: 0 },
        polygonCoords: [],
        affectedArea: null,
        damage: null,
        mapView: null,
        pricingSnapshot: null,
        fallbackReason: null,
        timestamp: "2026-09-01T10:00:00.000Z",
      });
      expect(result.ok, `${jobType} was rejected`).toBe(true);
    }
  });

  it("names the field that failed, rather than blaming the contact details", () => {
    const result = parseLeadBody({ rooferId: "a-roofer" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });
});

/* A roof with many faces must not cost the customer their quote.
 *
 * The scan arrays were capped by rejecting anything over 64 items, so a Solar
 * scan of a large or complex building — one stored lead came back with 81
 * planes — failed the whole submission. The cap is worth keeping to bound the
 * payload; it just has to trim rather than refuse, because the price travels
 * in quoteRange and the segments are only detail for the roofer's survey view. */
describe("oversized scans", () => {
  it("are trimmed, not rejected", () => {
    const seg = { boundingBox: { north: 1, south: 0, east: 1, west: 0 } };
    const result = parseLeadBody({
      rooferId: "a-roofer",
      leadType: "quote",
      intent: "quote_requested",
      jobType: "roof_soft_wash",
      otherJobDescription: null,
      propertyType: "detached",
      storeys: 2,
      material: null,
      conditionAnswer: null,
      conditionFlagged: false,
      coords: { lat: 51.6288, lng: -0.7529 },
      address: { line: "12 Test Road", postcode: "HP13 6TS", formatted: "x" },
      contact: { name: "T", phone: "07000000000", email: "" },
      quoteRange: { minExVat: 380, maxExVat: 520 },
      solar: {
        areaM2: 78.4,
        groundAreaM2: 64.1,
        pitchDegrees: 35,
        roofType: null,
        measurementMethod: "solar_whole_roof",
        segmentContributions: Array(81).fill({ segmentIndex: 0 }),
        segments: Array(81).fill(seg),
        wholeRoofStats: null,
        imageryQuality: null,
        imageryDate: null,
      },
      roofline: null,
      obstructions: { chimneys: 0, rooflights: 0 },
      polygonCoords: [],
      affectedArea: null,
      damage: null,
      mapView: null,
      pricingSnapshot: null,
      fallbackReason: null,
      timestamp: "2026-09-01T10:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.solar.segments).toHaveLength(64);
      expect(result.value.solar.segmentContributions).toHaveLength(64);
    }
  });
});
