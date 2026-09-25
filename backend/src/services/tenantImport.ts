import { parse } from "csv-parse/sync";
import { prisma } from "../prisma.js";
import type { Actor } from "./audit.js";
import { audit } from "./audit.js";

/**
 * Import a property-management tenant list (Property, Unit, Tenant columns).
 *
 * Idempotent: a person already on the site's active roster at the same unit
 * with the same name is left alone, so the same export can be re-run safely.
 * The importer only ever ADDS — someone missing from a later export is not
 * archived automatically; that decision belongs to the review queue, where a
 * person makes it.
 */

export interface ParsedName {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}

/**
 * Split a free-text name. (Examples are invented — never put real residents in code.)
 *   "Jane Example"                 → Jane / Example
 *   "Sample, Robert"               → Robert / Sample
 *   'Sample, Robert "Bobby"'       → Robert / Sample, preferred Bobby
 *   "Maria (Mimi) Placeholder"     → Maria / Placeholder, preferred Mimi
 *   "Alex “Lex” Testperson"         → Alex / Testperson, preferred Lex
 */
export function parseName(raw: string): ParsedName {
  let s = raw.replace(/[“”„«»]/g, '"').replace(/\s+/g, " ").trim();
  let preferredName: string | null = null;
  const nick = s.match(/["(]\s*([^")]+?)\s*[")]/);
  if (nick) {
    preferredName = nick[1].trim() || null;
    s = s.replace(nick[0], " ").replace(/\s+/g, " ").trim();
  }
  let firstName: string;
  let lastName: string;
  if (s.includes(",")) {
    const [last, ...rest] = s.split(",");
    lastName = last.trim();
    firstName = rest.join(" ").trim();
  } else {
    const parts = s.split(" ");
    lastName = parts.length > 1 ? parts.pop()! : "";
    firstName = parts.join(" ");
  }
  if (!firstName) {
    firstName = lastName;
    lastName = "";
  }
  return { firstName, lastName, preferredName };
}

/** "Amber Hall LP" → { name: "Amber Hall", code: "amber-hall" } */
export function siteFromEntity(entity: string) {
  const name = entity.replace(/\s+(LP|LLC|HDFC|Inc\.?|L\.P\.)$/i, "").trim();
  const code = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { name, code };
}

/** Exports come out of Excel on Windows: try UTF-8, fall back to cp1252. */
export function decodeCsv(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("windows-1252").decode(buf);
}

export interface ImportRow {
  property: string;
  unit: string;
  tenant: string;
}

export function readRows(text: string): ImportRow[] {
  const records = parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<
    string,
    string
  >[];
  const pick = (r: Record<string, string>, ...names: string[]) => {
    const key = Object.keys(r).find((k) => names.includes(k.trim().toLowerCase()));
    return key ? (r[key] ?? "").trim() : "";
  };
  return records.map((r) => ({
    property: pick(r, "property", "site", "building"),
    unit: pick(r, "unit", "apt", "room", "bed"),
    tenant: pick(r, "tenant", "name", "resident", "client"),
  }));
}

export interface ImportSummary {
  rows: number;
  skippedBlank: number;
  sitesCreated: string[];
  added: number;
  alreadyPresent: number;
  bySite: { site: string; added: number; alreadyPresent: number }[];
  samples: { site: string; unit: string; raw: string; parsed: ParsedName }[];
}

export async function importTenants(
  rows: ImportRow[],
  opts: { commit: boolean; actor: Actor }
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    rows: rows.length,
    skippedBlank: 0,
    sitesCreated: [],
    added: 0,
    alreadyPresent: 0,
    bySite: [],
    samples: [],
  };
  const siteIds = new Map<string, string>();
  const per = new Map<string, { added: number; alreadyPresent: number }>();

  for (const row of rows) {
    if (!row.property || !row.tenant) {
      summary.skippedBlank++;
      continue;
    }
    const { name, code } = siteFromEntity(row.property);
    let siteId = siteIds.get(row.property);
    if (!siteId) {
      const existing = await prisma.site.findFirst({ where: { OR: [{ entityName: row.property }, { code }] } });
      if (existing) siteId = existing.id;
      else {
        summary.sitesCreated.push(name);
        siteId = opts.commit
          ? (await prisma.site.create({ data: { code, name, entityName: row.property } })).id
          : `new:${code}`;
      }
      siteIds.set(row.property, siteId);
    }

    const parsed = parseName(row.tenant);
    if (summary.samples.length < 12 && (parsed.preferredName || row.tenant.includes(","))) {
      summary.samples.push({ site: name, unit: row.unit, raw: row.tenant, parsed });
    }
    const bucket = per.get(name) ?? { added: 0, alreadyPresent: 0 };
    per.set(name, bucket);

    const present = siteId.startsWith("new:")
      ? null
      : await prisma.tenant.findFirst({
          where: {
            siteId,
            status: "active",
            unit: row.unit || null,
            firstName: parsed.firstName,
            lastName: parsed.lastName,
          },
          select: { id: true },
        });
    if (present) {
      summary.alreadyPresent++;
      bucket.alreadyPresent++;
      continue;
    }
    summary.added++;
    bucket.added++;
    if (opts.commit) {
      await prisma.tenant.create({
        data: {
          siteId,
          unit: row.unit || null,
          ...parsed,
          createdById: opts.actor.id,
        },
      });
    }
  }

  summary.bySite = [...per.entries()]
    .map(([site, v]) => ({ site, ...v }))
    .sort((a, b) => a.site.localeCompare(b.site));

  if (opts.commit) {
    await audit({
      actor: opts.actor,
      action: "import.completed",
      summary: `Imported ${summary.added} resident${summary.added === 1 ? "" : "s"} across ${summary.bySite.length} site${summary.bySite.length === 1 ? "" : "s"}`,
      changes: { added: summary.added, alreadyPresent: summary.alreadyPresent, sitesCreated: summary.sitesCreated },
    });
  }
  return summary;
}
