export type JobType =
  | "full_replacement"
  | "tile_or_slate_repair"
  | "flat_roof_replacement"
  | "gutters_fascias_soffits"
  | "roof_soft_wash"
  | "roof_biocide_treatment"
  | "gutter_clearing"
  | "leak_investigation"
  | "other";

export type MeasuredJobType =
  | "full_replacement"
  | "flat_roof_replacement";

export type RoofType = "gable" | "hip" | "flat";
export type PricingMode = "replacement" | "repair" | "roofline" | "cleaning";
export type PropertyType =
  | "detached"
  | "semi_detached"
  | "end_of_terrace"
  | "terraced"
  | "bungalow"
  | "flat";
export type StoreyBand = 1 | 2 | 3 | 4;
export type RooflineScope = "gutters_only" | "gutters_fascias";
export type RoofObstructionKind = "chimney" | "rooflight";
export type RoofObstruction = {
  kind: RoofObstructionKind;
  bounds: GeoBounds;
  /** Four corners in map order when the obstruction was marked with the
   * oriented three-point tool. `bounds` remains for pricing calculations. */
  path?: LatLng[];
};
export type DrawnRoof = {
  /** Stable id for React keys / controlled map polygons. */
  id: string;
  path: LatLng[];
  gutterEdgeIndices: number[];
  obstructions: RoofObstruction[];
};
export type ReplacementMaterial =
  | "concrete_tile"
  | "clay_tile"
  | "natural_slate"
  | "flat_bitumen"
  | "flat_epdm"
  | "flat_grp"
  | "not_sure";
export type RepairMaterial =
  | "concrete_tile"
  | "clay_tile"
  | "natural_slate"
  | "fibre_cement"
  | "flat_bitumen"
  | "flat_epdm"
  | "flat_grp"
  | "polycarbonate"
  | "glass_plain"
  | "glass_laminated"
  | "felt"
  | "not_sure";
export type Material = ReplacementMaterial | RepairMaterial;
export type ConditionAnswer = "yes" | "no" | "not_sure";

export type LatLng = {
  lat: number;
  lng: number;
};

export type GeoBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type RoofStats = {
  areaMeters2: number;
  groundAreaMeters2: number;
};

export type RoofSegment = {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2: number;
  groundAreaMeters2: number;
  boundingBox: GeoBounds;
  center?: LatLng;
  planeHeightAtCenterMeters?: number;
};

export type SolarScan = {
  center: LatLng;
  boundingBox: GeoBounds;
  imageryQuality: string;
  imageryDate: string | null;
  wholeRoofStats: RoofStats;
  roofSegmentStats: RoofSegment[];
};

export type SegmentContribution = {
  segmentIndex: number;
  bboxAreaM2: number;
  polygonIntersectionAreaM2: number;
  overlapRatio: number;
  selectedGroundAreaM2: number;
  pitchMultiplier: number;
  uncalibratedSurfaceAreaM2: number;
  selectedSurfaceAreaM2: number;
  pitchDegrees: number;
  azimuthDegrees: number;
};

export type RoofMeasurement = {
  surfaceAreaM2: number;
  groundAreaM2: number;
  averagePitchDegrees: number;
  roofType: RoofType;
  intersectedSegments: number;
  method: "solar_whole_roof" | "segment_bbox_overlap";
  surfaceCalibrationFactor: number;
  contributions: SegmentContribution[];
};

export type QuoteLineItem = {
  label: string;
  detail?: string;
  min: number;
  max: number;
  rateId?: string;
  unit?: "m²" | "m" | "week" | "hour" | "day" | "fixed";
  quantity?: number;
  unitRateMin?: number;
  unitRateMax?: number;
  sourceTitle?: string;
  sourceAsOf?: string;
  quantityM2?: number;
};

export type QuoteResult = {
  estimateType: "indicative_estimate";
  pricingMode: PricingMode;
  min: number;
  max: number;
  pricingAreaM2: number | null;
  confidenceWidth: number;
  modelAssumptions: string[];
  lineItems: QuoteLineItem[];
};

export type RoofFeatureType = "ridge" | "hip" | "valley" | "unresolved";

export type RoofLineFeature = {
  segmentA: number;
  segmentB: number;
  type: RoofFeatureType;
  lengthM: number;
  start: LatLng;
  end: LatLng;
  midpoint: LatLng;
  confidence: "low" | "medium";
  azimuthDifferenceDegrees: number;
  reason: string;
};

export type RoofLineMeasurement = {
  method: "solar_plane_intersection_bbox_clip";
  totals: Record<RoofFeatureType, number>;
  features: RoofLineFeature[];
  skippedPairs: number;
  warning: string;
};

/**
 * How severe the visible damage is, graded 1-5 from customer-supplied photos
 * and anchored to the RICS Home Survey condition ratings (1 = CR1 "no repair
 * currently needed", 3 = CR2 "needs repair, not urgent", 5 = CR3 "serious
 * and/or urgent"). Only produced for the repair-shaped jobs that have no
 * measured area, where extent is otherwise invisible to the estimate.
 *
 * `confidence` deliberately cannot be "low": a low-confidence grading is
 * discarded at the boundary and stored as a null severity, so anything that
 * reaches this type is safe to price on.
 */
export type DamageSeverity = {
  score: 1 | 2 | 3 | 4 | 5;
  confidence: "medium" | "high";
  /** Short phrases naming what the grader could actually see. */
  visibleIssues: string[];
  /** Which model produced the score, so a re-grade can be compared later. */
  model: string;
};

export type ContactDetails = {
  name: string;
  phone: string;
  email: string;
};

/**
 * How much intent the person has shown. `estimate_viewed` = they gave details
 * and saw a ballpark but haven't asked to proceed (a "priced only" lead).
 * `quote_requested` = they clicked "get my exact quote" on the estimate.
 * `callback_requested` = they used the consultation path ("request my call
 * back"), which is already an explicit ask. Used to tier leads on the
 * dashboard so roofers only chase the genuinely interested.
 */
export type LeadIntent =
  | "estimate_viewed"
  | "quote_requested"
  | "callback_requested";

export type LeadPayload = {
  rooferId: string;
  leadType: "quote" | "manual_consultation";
  intent: LeadIntent;
  jobType: JobType;
  otherJobDescription: string | null;
  address: {
    postcode: string;
    line: string;
    formatted: string | null;
  };
  coords: LatLng | null;
  solar: {
    areaM2: number | null;
    groundAreaM2: number | null;
    pitchDegrees: number | null;
    roofType: RoofType | null;
    measurementMethod: RoofMeasurement["method"] | null;
    segmentContributions: SegmentContribution[];
    segments: RoofSegment[];
    wholeRoofStats: RoofStats | null;
    imageryQuality: string | null;
    imageryDate: string | null;
  };
  polygonCoords: LatLng[] | null;
  /**
   * Centre + zoom of the satellite map the customer drew on, so the roofer's
   * dashboard can reopen the roof on the same framing rather than inferring
   * one from the polygon. Null when the flow never showed a map.
   */
  mapView: { center: LatLng; zoom: number } | null;
  conditionAnswer: ConditionAnswer | null;
  conditionFlagged: boolean;
  material: Material | null;
  propertyType: PropertyType | null;
  storeys: StoreyBand | null;
  quoteRange: {
    minExVat: number;
    maxExVat: number;
  } | null;
  /** Audit: which company config produced this quote (optional). */
  pricingSnapshot?: {
    version: 1;
    fingerprint: string;
    enabledServices: string[];
  } | null;
  /**
   * Photos the customer attached and what the grader made of them. Null when
   * the job type never offers the step or the customer skipped it. `severity`
   * is separately null when photos were uploaded but not gradeable (grader
   * unavailable, or low confidence) — in every one of those cases the estimate
   * is exactly what it would have been with no photos at all.
   */
  damage: {
    photoPaths: string[];
    severity: DamageSeverity | null;
  } | null;
  contact: ContactDetails;
  fallbackReason: string | null;
  timestamp: string;
  roofline: {
    perimeterM: number | null;
    gutterLengthM: number | null;
    scope: RooflineScope | null;
  } | null;
  obstructions: {
    chimneys: number;
    rooflights: number;
  } | null;
};
