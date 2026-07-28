import type { SupabaseClient } from "@supabase/supabase-js";

import { loggedFetch } from "@/lib/logged-fetch";

import type { LeadRow } from "@/lib/leads";

/**
 * Roofer lead notifications via Resend.
 *
 * When a genuinely-new lead is persisted, email the roofer so they can call the
 * homeowner while the lead is warm. Recipients are the login emails of everyone
 * linked to that roofer (roofer_members -> auth.users) — read with the service
 * role, since auth.users is admin-only. There is no notify_email column yet.
 *
 * Fully dev-safe: with no RESEND_API_KEY set (local, tests) it no-ops, exactly
 * like the webhook. Delivery is best-effort — a failure here never fails the
 * lead, which is already saved by the time we get here.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type NotifyConfig =
  | { ok: true; apiKey: string; from: string; replyToLead: boolean }
  | { ok: false; reason: "no_api_key" };

let configCache: NotifyConfig | undefined;
let warnedMissing = false;

/** Test helper — clears memoised config between cases. */
export function resetLeadEmailConfigCache(): void {
  configCache = undefined;
  warnedMissing = false;
}

export function getLeadEmailConfig(): NotifyConfig {
  if (configCache !== undefined) return configCache;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    if (!warnedMissing) {
      console.warn("RESEND_API_KEY not configured; lead emails are disabled.");
      warnedMissing = true;
    }
    configCache = { ok: false, reason: "no_api_key" };
    return configCache;
  }

  // Onboarding default sends from Resend's shared domain and only delivers to
  // your own verified address — fine for testing. Set LEAD_NOTIFY_FROM to a
  // verified domain (e.g. "Quoter <leads@quoter.app>") before launch.
  const from =
    process.env.LEAD_NOTIFY_FROM?.trim() || "Quoter <onboarding@resend.dev>";
  // Reply-To = the homeowner, so the roofer can reply straight to the lead.
  const replyToLead = process.env.LEAD_NOTIFY_REPLY_TO_LEAD !== "false";

  configCache = { ok: true, apiKey, from, replyToLead };
  return configCache;
}

/** Login emails of everyone linked to this roofer (deduped, lowercased). */
export async function getRooferNotifyEmails(
  supabase: SupabaseClient,
  rooferUuid: string,
): Promise<string[]> {
  const { data: members, error } = await supabase
    .from("roofer_members")
    .select("user_id")
    .eq("roofer_id", rooferUuid);

  if (error || !members?.length) return [];

  const emails: string[] = [];
  for (const member of members as { user_id: string }[]) {
    const { data, error: userError } = await supabase.auth.admin.getUserById(
      member.user_id,
    );
    const email = data?.user?.email;
    if (userError || !email) continue;
    emails.push(email.toLowerCase());
  }

  return [...new Set(emails)];
}

function formatGbp(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

function titleCase(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildLeadEmail(row: LeadRow): {
  subject: string;
  html: string;
  text: string;
} {
  const name = row.contact_name?.trim() || "New lead";
  const postcode = row.address_postcode?.trim() || "";
  const subject = `New roof lead: ${name}${postcode ? ` — ${postcode}` : ""}`;

  const quote =
    row.quote_min_ex_vat != null && row.quote_max_ex_vat != null
      ? `${formatGbp(row.quote_min_ex_vat)}–${formatGbp(row.quote_max_ex_vat)} (ex VAT)`
      : "Not measured — price after survey";

  const job = titleCase(row.job_type) ?? "—";
  const address = row.address_formatted?.trim() || postcode || "—";
  const phone = row.contact_phone?.trim() || "—";
  const email = row.contact_email?.trim() || "—";

  const rows: [string, string][] = [
    ["Name", name],
    ["Phone", phone],
    ["Email", email],
    ["Address", address],
    ["Job", job],
    ["Instant estimate", quote],
  ];

  const text = [
    `New roof lead${postcode ? ` in ${postcode}` : ""}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
  ].join("\n");

  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:11px 24px 11px 0;color:#6b7280;font-size:14px;white-space:nowrap;vertical-align:top">${escapeHtml(
          k,
        )}</td><td style="padding:11px 0;color:#111827;font-size:16px;font-weight:600">${escapeHtml(
          v,
        )}</td></tr>`,
    )
    .join("");

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f6fb;padding:32px 20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;border:1px solid #eef0f5">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#2f6bff;letter-spacing:.04em">NEW LEAD</p>
    <h1 style="margin:0 0 28px;font-size:25px;color:#111827">${escapeHtml(name)} just requested a quote</h1>
    <table style="border-collapse:collapse;width:100%">${tableRows}</table>
    <p style="margin:30px 0 0;font-size:13px;color:#9ca3af">Sent by Quoter · reply to this email to reach the customer.</p>
  </div>
</div>`;

  return { subject, html, text };
}

/**
 * Best-effort: email the roofer about a new lead. Returns why it did/didn't
 * send rather than throwing for expected skips (no key / no recipient); only a
 * genuine Resend API failure throws, for the caller to log.
 */
export async function sendLeadEmail(
  supabase: SupabaseClient,
  row: LeadRow,
): Promise<{ sent: boolean; reason?: string; recipients?: number }> {
  const config = getLeadEmailConfig();
  if (!config.ok) return { sent: false, reason: config.reason };

  const recipients = await getRooferNotifyEmails(supabase, row.roofer_id);
  if (!recipients.length) {
    console.warn("No notify email linked to roofer; skipping lead email.", {
      rooferId: row.roofer_id,
    });
    return { sent: false, reason: "no_recipient" };
  }

  const { subject, html, text } = buildLeadEmail(row);
  const body: Record<string, unknown> = {
    from: config.from,
    to: recipients,
    subject,
    html,
    text,
  };
  if (config.replyToLead && row.contact_email?.trim()) {
    body.reply_to = row.contact_email.trim();
  }

  const response = await loggedFetch("lead-email", RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  return { sent: true, recipients: recipients.length };
}

/* ------------------------------------------------------------------ */
/* Customer-facing "here's your estimate" email                        */
/* ------------------------------------------------------------------ */

/** Swap the display name on a Resend "Name <addr>" from-string (keeps addr). */
function fromWithName(configFrom: string, displayName: string | null): string {
  const name = displayName?.trim();
  if (!name) return configFrom;
  const match = configFrom.match(/<([^>]+)>/);
  const addr = match ? match[1] : configFrom.trim();
  return `${name} <${addr}>`;
}

/** The roofer's display name, for branding the customer's estimate email. */
export async function getRooferName(
  supabase: SupabaseClient,
  rooferUuid: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("roofers")
    .select("name")
    .eq("id", rooferUuid)
    .maybeSingle();
  if (error) return null;
  return (data?.name as string | undefined)?.trim() || null;
}

export function buildCustomerEstimateEmail(
  row: LeadRow,
  rooferName: string | null,
): { subject: string; html: string; text: string } {
  const firstName = row.contact_name?.trim().split(" ")[0] || "there";
  const roofer = rooferName?.trim() || "your local roofer";
  const jobLower = titleCase(row.job_type)?.toLowerCase() ?? "roof work";
  const postcode = row.address_postcode?.trim() || "";
  const address = row.address_formatted?.trim() || postcode || "your property";
  const range =
    row.quote_min_ex_vat != null && row.quote_max_ex_vat != null
      ? `${formatGbp(row.quote_min_ex_vat)} – ${formatGbp(row.quote_max_ex_vat)}`
      : null;

  const subject = `Your ${jobLower} estimate${postcode ? ` — ${postcode}` : ""}`;

  const text = [
    `Hi ${firstName},`,
    "",
    `Here's your estimate for ${jobLower} at ${address}:`,
    "",
    range ? `${range} (excl. VAT)` : "Your roofer will confirm your price after a visit.",
    "",
    `This is a guide based on satellite measurements — ${roofer} will confirm the exact price after a free, no-obligation visit.`,
    "",
    "Thanks for using Quoter.",
  ].join("\n");

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f6fb;padding:32px 20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;border:1px solid #eef0f5">
    <h1 style="margin:0 0 6px;font-size:22px;color:#111827">Hi ${escapeHtml(firstName)}, here's your estimate</h1>
    <p style="margin:0 0 26px;font-size:15px;color:#6b7280">${escapeHtml(jobLower)} · ${escapeHtml(address)}</p>
    <div style="text-align:center;background:#f6f8ff;border-radius:14px;padding:26px 20px;margin-bottom:26px">
      <p style="margin:0;font-size:30px;font-weight:700;color:#111827">${escapeHtml(range ?? "Priced after a visit")}</p>
      ${range ? `<p style="margin:6px 0 0;font-size:13px;color:#9ca3af">excl. VAT</p>` : ""}
    </div>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#374151">This is a guide based on satellite measurements. <strong>${escapeHtml(
      roofer,
    )}</strong> will confirm your exact price after a free, no-obligation visit.</p>
    <p style="margin:26px 0 0;font-size:13px;color:#9ca3af">Sent by Quoter on behalf of ${escapeHtml(roofer)}.</p>
  </div>
</div>`;

  return { subject, html, text };
}

/**
 * Best-effort: email the customer their estimate. Needs their email and a
 * measured range (estimate path only). Branded as the roofer, reply-to the
 * roofer so a customer reply reaches them. No-ops with no RESEND_API_KEY.
 */
export async function sendCustomerEstimateEmail(
  supabase: SupabaseClient,
  row: LeadRow,
): Promise<{ sent: boolean; reason?: string }> {
  const config = getLeadEmailConfig();
  if (!config.ok) return { sent: false, reason: config.reason };

  const to = row.contact_email?.trim();
  if (!to) return { sent: false, reason: "no_customer_email" };
  if (row.quote_min_ex_vat == null || row.quote_max_ex_vat == null) {
    return { sent: false, reason: "no_estimate" };
  }

  const rooferName = await getRooferName(supabase, row.roofer_id);
  const { subject, html, text } = buildCustomerEstimateEmail(row, rooferName);
  const rooferEmails = await getRooferNotifyEmails(supabase, row.roofer_id);

  const body: Record<string, unknown> = {
    from: fromWithName(config.from, rooferName),
    to: [to],
    subject,
    html,
    text,
  };
  if (rooferEmails.length) body.reply_to = rooferEmails[0];

  const response = await loggedFetch("customer-estimate-email", RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  return { sent: true };
}
