import { preflight, withCors } from "@/lib/cors";
import { getServiceSupabase } from "@/lib/supabase";

import { NextResponse } from "next/server";

/**
 * Public roofer lookup by slug — powers the hosted Quote Link page
 * (quoter-widget-frontend `/l/[roofer]`), which needs the roofer's display
 * name to brand the page. The `roofers` table is RLS-locked, so this trusted
 * server route reads it with the service role and returns ONLY public fields
 * (slug + name). Nothing sensitive is exposed.
 */
async function handleGet(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json({ error: "A roofer slug is required." }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Roofer lookup is temporarily unavailable." },
      { status: 503 },
    );
  }

  const { data, error } = await supabase
    .from("roofers")
    .select("id,slug,name")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Roofer lookup failed", error);
    return NextResponse.json(
      { error: "Roofer lookup is temporarily unavailable." },
      { status: 502 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Roofer not found." }, { status: 404 });
  }

  // Per-roofer pricing (nullable). Only returned when the roofer has actually
  // saved custom rates — otherwise the widget uses its default price model, so
  // roofers without pricing are unaffected. Normalised to camelCase for the
  // widget's RooferPricing type.
  let pricing: {
    materials: { key: string; rate: number }[];
    labourPerDay: number | null;
    minimumCallout: number | null;
    skipHire: number | null;
    scaffoldPerWeek: number | null;
    vatRegistered: boolean;
  } | null = null;

  const { data: priceRow } = await supabase
    .from("roofer_pricing")
    .select(
      "materials,labour_per_day,minimum_callout,skip_hire,scaffold_per_week,vat_registered",
    )
    .eq("roofer_id", data.id)
    .maybeSingle();

  if (priceRow) {
    const rawMaterials = Array.isArray(priceRow.materials)
      ? (priceRow.materials as { key?: unknown; rate?: unknown }[])
      : [];
    const materials = rawMaterials
      .filter(
        (m) =>
          typeof m.key === "string" &&
          typeof m.rate === "number" &&
          Number.isFinite(m.rate) &&
          m.rate > 0,
      )
      .map((m) => ({ key: m.key as string, rate: m.rate as number }));
    pricing = {
      materials,
      labourPerDay: priceRow.labour_per_day ?? null,
      minimumCallout: priceRow.minimum_callout ?? null,
      skipHire: priceRow.skip_hire ?? null,
      scaffoldPerWeek: priceRow.scaffold_per_week ?? null,
      vatRegistered: priceRow.vat_registered ?? true,
    };
  }

  return NextResponse.json({
    roofer: { slug: data.slug, name: data.name },
    pricing,
  });
}

export const GET = withCors(handleGet);
export const OPTIONS = preflight;
