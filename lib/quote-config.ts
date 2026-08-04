/**
 * Service-first quote config — shared contract for admin onboarding,
 * Account edits, and (via API projection) the widget.
 */

export type ServiceKey =
  | "full_replacement"
  | "flat_roof_replacement"
  | "tile_or_slate_repair"
  | "gutters_fascias_soffits"
  | "roof_soft_wash"
  | "roof_biocide_treatment"
  | "gutter_clearing"
  | "leak_investigation"
  | "other";

/** Roofing services enabled by default for a new roofer. */
export const ROOFING_SERVICE_KEYS: ServiceKey[] = [
  "full_replacement",
  "flat_roof_replacement",
  "tile_or_slate_repair",
  "gutters_fascias_soffits",
  "leak_investigation",
  "other",
];

/** Roof-cleaning services (a cleaner's starting set). */
export const CLEANING_SERVICE_KEYS: ServiceKey[] = [
  "roof_soft_wash",
  "roof_biocide_treatment",
  "gutter_clearing",
];

export type AccessMode =
  | "scaffold_weeks"
  | "fixed_access"
  | "mewp_day"
  | "tower"
  | "none";

export type AccessPolicy = {
  mode: AccessMode;
  /** £/week for scaffold_weeks; £ fixed for fixed_access/mewp_day/tower. */
  rateExVat: number;
};

export type MaterialRate = {
  key: string;
  label: string;
  rateExVat: number;
  /** When false, material is hidden in the bubble for this service. */
  enabled: boolean;
};

export type ReplacementServiceConfig = {
  materials: MaterialRate[];
  stripOffPerM2: number;
  includeSkip: boolean;
  skipHireExVat: number;
  access: AccessPolicy;
  includeGutters: boolean;
  gutterPerMExVat: number;
  includeChimneyAllowance: boolean;
  chimneyAllowanceExVat: number;
};

export type RepairServiceConfig = {
  materials: MaterialRate[];
  access: AccessPolicy;
};

export type RooflineServiceConfig = {
  gutterPerMExVat: number;
  fasciaSoffitPerMExVat: number;
  access: AccessPolicy;
};

/** Cleaning priced per m² of measured roof area, with a call-out floor. */
export type AreaCleanServiceConfig = {
  ratePerM2ExVat: number;
  minCalloutExVat: number;
};

/** A flat-price service (e.g. a gutter clear-out). */
export type FlatServiceConfig = {
  fixedExVat: number;
};

export type ServiceConfigs = {
  full_replacement?: ReplacementServiceConfig;
  flat_roof_replacement?: ReplacementServiceConfig;
  tile_or_slate_repair?: RepairServiceConfig;
  gutters_fascias_soffits?: RooflineServiceConfig;
  roof_soft_wash?: AreaCleanServiceConfig;
  roof_biocide_treatment?: AreaCleanServiceConfig;
  gutter_clearing?: FlatServiceConfig;
};

export type QuoteConfig = {
  version: 1;
  enabledServices: ServiceKey[];
  services: ServiceConfigs;
  vatRegistered: boolean;
  /** Optional band widener (0.12 = ±12%). Null/undefined = widget default. */
  confidenceWidth?: number | null;
};

export type ServiceMeta = {
  key: ServiceKey;
  label: string;
  description: string;
  /** Needs rate variables in the editor. */
  priced: boolean;
};

export const SERVICE_CATALOG: ServiceMeta[] = [
  {
    key: "full_replacement",
    label: "Full roof replacement",
    description: "Pitched tile/slate replacements with measured area.",
    priced: true,
  },
  {
    key: "flat_roof_replacement",
    label: "New flat roof",
    description: "Bitumen, EPDM or GRP flat systems.",
    priced: true,
  },
  {
    key: "tile_or_slate_repair",
    label: "Tile or slate repair",
    description: "Smaller repair patches by material.",
    priced: true,
  },
  {
    key: "gutters_fascias_soffits",
    label: "Gutters, fascias & soffits",
    description: "Roofline work priced per metre.",
    priced: true,
  },
  {
    key: "roof_soft_wash",
    label: "Roof soft wash / moss removal",
    description: "Soft-wash clean priced per m² of measured roof.",
    priced: true,
  },
  {
    key: "roof_biocide_treatment",
    label: "Biocide treatment",
    description: "Long-acting moss treatment priced per m².",
    priced: true,
  },
  {
    key: "gutter_clearing",
    label: "Gutter clearing",
    description: "Flat-price gutter clear-out.",
    priced: true,
  },
  {
    key: "leak_investigation",
    label: "Leak investigation",
    description: "Callback lead — no instant price.",
    priced: false,
  },
  {
    key: "other",
    label: "Something else",
    description: "Catch-all callback lead — no instant price.",
    priced: false,
  },
];

export const PRICED_SERVICES = SERVICE_CATALOG.filter((s) => s.priced).map(
  (s) => s.key,
);

const PITCHED_MATERIALS: MaterialRate[] = [
  { key: "concrete_tile", label: "Concrete tile", rateExVat: 107, enabled: true },
  { key: "clay_tile", label: "Clay tile", rateExVat: 140, enabled: true },
  { key: "natural_slate", label: "Natural slate", rateExVat: 185, enabled: true },
];

const FLAT_MATERIALS: MaterialRate[] = [
  { key: "flat_bitumen", label: "Felt / bitumen", rateExVat: 72, enabled: true },
  { key: "flat_epdm", label: "EPDM rubber", rateExVat: 87, enabled: true },
  { key: "flat_grp", label: "GRP fibreglass", rateExVat: 100, enabled: true },
];

const REPAIR_MATERIALS: MaterialRate[] = [
  { key: "concrete_tile", label: "Concrete tile", rateExVat: 105, enabled: true },
  { key: "clay_tile", label: "Clay tile", rateExVat: 135, enabled: true },
  { key: "natural_slate", label: "Natural slate", rateExVat: 185, enabled: true },
  { key: "fibre_cement", label: "Fibre cement", rateExVat: 110, enabled: true },
  { key: "felt", label: "Felt", rateExVat: 265, enabled: true },
  { key: "flat_epdm", label: "EPDM rubber", rateExVat: 145, enabled: true },
  { key: "flat_grp", label: "GRP fibreglass", rateExVat: 155, enabled: true },
];

export function defaultAccess(mode: AccessMode = "scaffold_weeks"): AccessPolicy {
  if (mode === "none") return { mode: "none", rateExVat: 0 };
  if (mode === "scaffold_weeks") return { mode, rateExVat: 625 };
  if (mode === "mewp_day") return { mode, rateExVat: 280 };
  if (mode === "tower") return { mode, rateExVat: 120 };
  return { mode: "fixed_access", rateExVat: 350 };
}

export function defaultReplacementPitched(): ReplacementServiceConfig {
  return {
    materials: PITCHED_MATERIALS.map((m) => ({ ...m })),
    stripOffPerM2: 12,
    includeSkip: true,
    skipHireExVat: 260,
    access: defaultAccess("scaffold_weeks"),
    includeGutters: true,
    gutterPerMExVat: 50,
    includeChimneyAllowance: true,
    chimneyAllowanceExVat: 350,
  };
}

export function defaultReplacementFlat(): ReplacementServiceConfig {
  return {
    materials: FLAT_MATERIALS.map((m) => ({ ...m })),
    stripOffPerM2: 12,
    includeSkip: true,
    skipHireExVat: 260,
    access: defaultAccess("scaffold_weeks"),
    includeGutters: true,
    gutterPerMExVat: 50,
    includeChimneyAllowance: false,
    chimneyAllowanceExVat: 350,
  };
}

export function defaultRepair(): RepairServiceConfig {
  return {
    materials: REPAIR_MATERIALS.map((m) => ({ ...m })),
    access: defaultAccess("scaffold_weeks"),
  };
}

export function defaultRoofline(): RooflineServiceConfig {
  return {
    gutterPerMExVat: 50,
    fasciaSoffitPerMExVat: 67,
    access: defaultAccess("scaffold_weeks"),
  };
}

/** UK-average soft wash (£/m² of roof) with a call-out floor. */
export function defaultSoftWash(): AreaCleanServiceConfig {
  return { ratePerM2ExVat: 14, minCalloutExVat: 150 };
}

/** UK-average biocide treatment (£/m²). */
export function defaultBiocide(): AreaCleanServiceConfig {
  return { ratePerM2ExVat: 5, minCalloutExVat: 100 };
}

/** UK-average flat gutter clear-out. */
export function defaultGutterClearing(): FlatServiceConfig {
  return { fixedExVat: 120 };
}

/** All service configs at defaults — the editor reads rates from here even for
 *  services that aren't enabled yet, so toggling one on just works. */
function allDefaultServiceConfigs(): ServiceConfigs {
  return {
    full_replacement: defaultReplacementPitched(),
    flat_roof_replacement: defaultReplacementFlat(),
    tile_or_slate_repair: defaultRepair(),
    gutters_fascias_soffits: defaultRoofline(),
    roof_soft_wash: defaultSoftWash(),
    roof_biocide_treatment: defaultBiocide(),
    gutter_clearing: defaultGutterClearing(),
  };
}

/** Default config for a new roofer — roofing services enabled, cleaning off. */
export function defaultQuoteConfig(): QuoteConfig {
  return {
    version: 1,
    enabledServices: [...ROOFING_SERVICE_KEYS],
    services: allDefaultServiceConfigs(),
    vatRegistered: true,
    confidenceWidth: null,
  };
}

/** Preset for a roof-cleaning business — cleaning services on, roofing off. */
export function roofCleaningConfig(): QuoteConfig {
  return {
    version: 1,
    enabledServices: [...CLEANING_SERVICE_KEYS],
    services: allDefaultServiceConfigs(),
    vatRegistered: false,
    confidenceWidth: null,
  };
}

/** Legacy Account form → quote_config (dual-read). */
export function legacyToQuoteConfig(legacy: {
  materials: { key: string; label: string; rate: number }[];
  labourPerDay: number;
  minimumCallout: number;
  skipHire: number;
  scaffoldPerWeek: number;
  vatRegistered: boolean;
}): QuoteConfig {
  const cfg = defaultQuoteConfig();
  cfg.vatRegistered = legacy.vatRegistered;

  const rate = (key: string, fallback: number) => {
    const m = legacy.materials.find((x) => x.key === key);
    // Map old "felt" key → flat_bitumen
    if (!m && key === "flat_bitumen") {
      const felt = legacy.materials.find((x) => x.key === "felt");
      return felt?.rate ?? fallback;
    }
    return m?.rate ?? fallback;
  };

  const pitched = cfg.services.full_replacement!;
  pitched.materials = pitched.materials.map((m) => ({
    ...m,
    rateExVat: rate(m.key, m.rateExVat),
  }));
  pitched.skipHireExVat = legacy.skipHire;
  pitched.access = {
    mode: "scaffold_weeks",
    rateExVat: legacy.scaffoldPerWeek,
  };

  const flat = cfg.services.flat_roof_replacement!;
  flat.materials = flat.materials.map((m) => ({
    ...m,
    rateExVat: rate(m.key, m.rateExVat),
  }));
  flat.skipHireExVat = legacy.skipHire;
  flat.access = {
    mode: "scaffold_weeks",
    rateExVat: legacy.scaffoldPerWeek,
  };

  const repair = cfg.services.tile_or_slate_repair!;
  repair.materials = repair.materials.map((m) => ({
    ...m,
    rateExVat: rate(m.key, m.rateExVat),
  }));
  repair.access = {
    mode: "scaffold_weeks",
    rateExVat: legacy.scaffoldPerWeek,
  };

  const roofline = cfg.services.gutters_fascias_soffits!;
  roofline.access = {
    mode: "scaffold_weeks",
    rateExVat: legacy.scaffoldPerWeek,
  };

  return cfg;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function parseAccess(raw: unknown, fallback: AccessPolicy): AccessPolicy {
  if (!isObj(raw)) return fallback;
  const mode = raw.mode;
  const modes: AccessMode[] = [
    "scaffold_weeks",
    "fixed_access",
    "mewp_day",
    "tower",
    "none",
  ];
  if (typeof mode !== "string" || !modes.includes(mode as AccessMode)) {
    return fallback;
  }
  return {
    mode: mode as AccessMode,
    rateExVat: num(raw.rateExVat, fallback.rateExVat),
  };
}

function parseMaterials(
  raw: unknown,
  defaults: MaterialRate[],
): MaterialRate[] {
  if (!Array.isArray(raw)) return defaults.map((m) => ({ ...m }));
  return defaults.map((d) => {
    const match = raw.find(
      (x) => isObj(x) && x.key === d.key,
    ) as Record<string, unknown> | undefined;
    if (!match) return { ...d };
    return {
      key: d.key,
      label: d.label,
      rateExVat: num(match.rateExVat, d.rateExVat),
      enabled: bool(match.enabled, d.enabled),
    };
  });
}

function parseAreaClean(
  raw: unknown,
  defaults: AreaCleanServiceConfig,
): AreaCleanServiceConfig {
  if (!isObj(raw)) return { ...defaults };
  return {
    ratePerM2ExVat: num(raw.ratePerM2ExVat, defaults.ratePerM2ExVat),
    minCalloutExVat: num(raw.minCalloutExVat, defaults.minCalloutExVat),
  };
}

function parseReplacement(
  raw: unknown,
  defaults: ReplacementServiceConfig,
): ReplacementServiceConfig {
  if (!isObj(raw)) return { ...defaults, materials: defaults.materials.map((m) => ({ ...m })), access: { ...defaults.access } };
  return {
    materials: parseMaterials(raw.materials, defaults.materials),
    stripOffPerM2: num(raw.stripOffPerM2, defaults.stripOffPerM2),
    includeSkip: bool(raw.includeSkip, defaults.includeSkip),
    skipHireExVat: num(raw.skipHireExVat, defaults.skipHireExVat),
    access: parseAccess(raw.access, defaults.access),
    includeGutters: bool(raw.includeGutters, defaults.includeGutters),
    gutterPerMExVat: num(raw.gutterPerMExVat, defaults.gutterPerMExVat),
    includeChimneyAllowance: bool(
      raw.includeChimneyAllowance,
      defaults.includeChimneyAllowance,
    ),
    chimneyAllowanceExVat: num(
      raw.chimneyAllowanceExVat,
      defaults.chimneyAllowanceExVat,
    ),
  };
}

/** Normalise unknown JSON into a full QuoteConfig (fills defaults). */
export function parseQuoteConfig(raw: unknown): QuoteConfig {
  const base = defaultQuoteConfig();
  if (!isObj(raw) || raw.version !== 1) return base;

  const enabled = Array.isArray(raw.enabledServices)
    ? (raw.enabledServices.filter((k) =>
        SERVICE_CATALOG.some((s) => s.key === k),
      ) as ServiceKey[])
    : base.enabledServices;

  const servicesRaw = isObj(raw.services) ? raw.services : {};

  return {
    version: 1,
    enabledServices: enabled.length ? enabled : base.enabledServices,
    services: {
      full_replacement: parseReplacement(
        servicesRaw.full_replacement,
        defaultReplacementPitched(),
      ),
      flat_roof_replacement: parseReplacement(
        servicesRaw.flat_roof_replacement,
        defaultReplacementFlat(),
      ),
      tile_or_slate_repair: (() => {
        const d = defaultRepair();
        const r = servicesRaw.tile_or_slate_repair;
        if (!isObj(r)) return d;
        return {
          materials: parseMaterials(r.materials, d.materials),
          access: parseAccess(r.access, d.access),
        };
      })(),
      gutters_fascias_soffits: (() => {
        const d = defaultRoofline();
        const r = servicesRaw.gutters_fascias_soffits;
        if (!isObj(r)) return d;
        return {
          gutterPerMExVat: num(r.gutterPerMExVat, d.gutterPerMExVat),
          fasciaSoffitPerMExVat: num(
            r.fasciaSoffitPerMExVat,
            d.fasciaSoffitPerMExVat,
          ),
          access: parseAccess(r.access, d.access),
        };
      })(),
      roof_soft_wash: parseAreaClean(
        servicesRaw.roof_soft_wash,
        defaultSoftWash(),
      ),
      roof_biocide_treatment: parseAreaClean(
        servicesRaw.roof_biocide_treatment,
        defaultBiocide(),
      ),
      gutter_clearing: (() => {
        const d = defaultGutterClearing();
        const r = servicesRaw.gutter_clearing;
        if (!isObj(r)) return d;
        return { fixedExVat: num(r.fixedExVat, d.fixedExVat) };
      })(),
    },
    vatRegistered: bool(raw.vatRegistered, true),
    confidenceWidth:
      typeof raw.confidenceWidth === "number" &&
      Number.isFinite(raw.confidenceWidth)
        ? raw.confidenceWidth
        : null,
  };
}

export type Completeness = {
  enabledPriced: number;
  completePriced: number;
  ready: boolean;
  warnings: string[];
};

function replacementComplete(c: ReplacementServiceConfig): boolean {
  const enabledMats = c.materials.filter((m) => m.enabled);
  if (enabledMats.length === 0) return false;
  if (enabledMats.some((m) => m.rateExVat <= 0)) return false;
  if (c.access.mode !== "none" && c.access.rateExVat <= 0) return false;
  if (c.includeSkip && c.skipHireExVat <= 0) return false;
  return true;
}

function repairComplete(c: RepairServiceConfig): boolean {
  const enabledMats = c.materials.filter((m) => m.enabled);
  if (enabledMats.length === 0) return false;
  if (enabledMats.some((m) => m.rateExVat <= 0)) return false;
  if (c.access.mode !== "none" && c.access.rateExVat <= 0) return false;
  return true;
}

function rooflineComplete(c: RooflineServiceConfig): boolean {
  if (c.gutterPerMExVat <= 0 || c.fasciaSoffitPerMExVat <= 0) return false;
  if (c.access.mode !== "none" && c.access.rateExVat <= 0) return false;
  return true;
}

function areaCleanComplete(c: AreaCleanServiceConfig): boolean {
  return c.ratePerM2ExVat > 0;
}

function flatComplete(c: FlatServiceConfig): boolean {
  return c.fixedExVat > 0;
}

export function assessCompleteness(config: QuoteConfig): Completeness {
  const warnings: string[] = [];
  const enabledPriced = config.enabledServices.filter((k) =>
    PRICED_SERVICES.includes(k),
  );
  let completePriced = 0;

  for (const key of enabledPriced) {
    let ok = false;
    if (key === "full_replacement" && config.services.full_replacement) {
      ok = replacementComplete(config.services.full_replacement);
    } else if (
      key === "flat_roof_replacement" &&
      config.services.flat_roof_replacement
    ) {
      ok = replacementComplete(config.services.flat_roof_replacement);
    } else if (
      key === "tile_or_slate_repair" &&
      config.services.tile_or_slate_repair
    ) {
      ok = repairComplete(config.services.tile_or_slate_repair);
    } else if (
      key === "gutters_fascias_soffits" &&
      config.services.gutters_fascias_soffits
    ) {
      ok = rooflineComplete(config.services.gutters_fascias_soffits);
    } else if (key === "roof_soft_wash" && config.services.roof_soft_wash) {
      ok = areaCleanComplete(config.services.roof_soft_wash);
    } else if (
      key === "roof_biocide_treatment" &&
      config.services.roof_biocide_treatment
    ) {
      ok = areaCleanComplete(config.services.roof_biocide_treatment);
    } else if (key === "gutter_clearing" && config.services.gutter_clearing) {
      ok = flatComplete(config.services.gutter_clearing);
    }
    if (ok) completePriced += 1;
    else {
      const label =
        SERVICE_CATALOG.find((s) => s.key === key)?.label ?? key;
      warnings.push(`${label} needs rates before going live.`);
    }
  }

  if (enabledPriced.length === 0) {
    warnings.push("Enable at least one priced service for the quote bubble.");
  }

  return {
    enabledPriced: enabledPriced.length,
    completePriced,
    ready: enabledPriced.length > 0 && completePriced === enabledPriced.length,
    warnings,
  };
}

/** Stable fingerprint for lead audit snapshots. */
export function configFingerprint(config: QuoteConfig): string {
  const json = JSON.stringify(config);
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = (Math.imul(31, h) + json.charCodeAt(i)) | 0;
  }
  return `v1_${(h >>> 0).toString(16)}`;
}
