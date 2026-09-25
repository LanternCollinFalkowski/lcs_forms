import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { asyncHandler, badRequest, HttpError, notFound } from "../http.js";
import { requireAuth, requirePermission } from "../auth/middleware.js";
import { resolveSite } from "../services/siteScope.js";
import { displayName, recordActivity } from "../services/roster.js";
import { actorOf, audit } from "../services/audit.js";
import { scopeLabel } from "../services/exportCommon.js";
import {
  buildReport, COLOR_SLOTS, hotFoodSettings, nextFreeColorSlot, loadAllEntries, loadEntries, loadEntryDetail, parseFilter, regularCounts, REGULARS_DAYS,
  ruleProblems, rulesFor, todayCounts, todayMeals,
} from "../services/hotFoods.js";
import { setSetting } from "../services/settings.js";
import {
  entriesCsv, entriesPdf, entriesXlsx, entryPdf, filename, reportPdf, reportXlsx, type ExportMeta,
} from "../services/hotFoodsExport.js";

export const hotFoodsRouter = Router();
hotFoodsRouter.use(requireAuth);

/**
 * Recording needs `roster.edit` (it names a resident at a site the person
 * works at, the same bar as taking attendance). Reading entries back needs
 * `entries.view`, which Site Staff don't have; voiding needs `entries.void`.
 */
const RECORD = "roster.edit" as const;
const READ = "entries.view" as const;

const EXPORT_TYPES = {
  csv: { mime: "text/csv; charset=utf-8", ext: "csv" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  pdf: { mime: "application/pdf", ext: "pdf" },
} as const;
type Format = keyof typeof EXPORT_TYPES;

function formatOf(raw: unknown, fallback: Format): Format {
  const f = String(raw ?? fallback);
  if (!(f in EXPORT_TYPES)) throw badRequest("format must be csv, xlsx or pdf.");
  return f as Format;
}

function sendFile(res: import("express").Response, format: Format, name: string, body: Buffer, inline: boolean) {
  res.setHeader("Content-Type", EXPORT_TYPES[format].mime);
  res.setHeader("Content-Disposition", `${inline && format === "pdf" ? "inline" : "attachment"}; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
}

// ── Meal types ───────────────────────────────────────────────────────────

hotFoodsRouter.get(
  "/items",
  asyncHandler(async (req, res) => {
    const all = req.query.all === "1" && req.user!.permissions.includes("forms.manage");
    res.json(await prisma.hotFoodItem.findMany({ where: all ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }));
  })
);

const itemBody = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  imageUrl: z.union([z.string().trim().url("Image must be a web address.").max(500), z.literal("")]).optional(),
  active: z.boolean().optional(),
  colorSlot: z.number().int().min(0).max(COLOR_SLOTS - 1).nullable().optional(),
});

hotFoodsRouter.post(
  "/items",
  requirePermission("forms.manage"),
  asyncHandler(async (req, res) => {
    const body = itemBody.parse(req.body);
    const last = await prisma.hotFoodItem.aggregate({ _max: { sortOrder: true } });
    const item = await prisma.hotFoodItem.create({
      data: {
        name: body.name, imageUrl: body.imageUrl || null, active: body.active ?? true, sortOrder: (last._max.sortOrder ?? -1) + 1,
        colorSlot: body.colorSlot !== undefined ? body.colorSlot : await nextFreeColorSlot(),
      },
    });
    await audit({ actor: actorOf(req), action: "hotfoods.item.created", summary: `Added Hot Foods meal type "${item.name}"` });
    res.status(201).json(item);
  })
);

hotFoodsRouter.patch(
  "/items/:id",
  requirePermission("forms.manage"),
  asyncHandler(async (req, res) => {
    const body = itemBody.partial().parse(req.body);
    const before = await prisma.hotFoodItem.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound("Meal type not found.");
    const item = await prisma.hotFoodItem.update({
      where: { id: before.id },
      data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl || null } : {}), ...(body.active !== undefined ? { active: body.active } : {}), ...(body.colorSlot !== undefined ? { colorSlot: body.colorSlot } : {}) },
    });
    await audit({ actor: actorOf(req), action: "hotfoods.item.updated", summary: `Updated Hot Foods meal type "${item.name}"`, changes: { name: [before.name, item.name], active: [before.active, item.active] } });
    res.json(item);
  })
);

hotFoodsRouter.post(
  "/items/reorder",
  requirePermission("forms.manage"),
  asyncHandler(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string()).max(200) }).parse(req.body);
    await prisma.$transaction(ids.map((id, i) => prisma.hotFoodItem.update({ where: { id }, data: { sortOrder: i } })));
    res.json({ ok: true });
  })
);

// ── Form settings (Admin → Hot Foods) ────────────────────────────────────

/** The limits. Which sites are shelters is each site's type, set in Admin → Sites. */
hotFoodsRouter.get(
  "/config",
  requirePermission("forms.manage"),
  asyncHandler(async (_req, res) => {
    res.json(await hotFoodSettings());
  })
);

hotFoodsRouter.patch(
  "/config",
  requirePermission("forms.manage"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        supportiveLimit: z.number().int().min(1, "At least 1 meal a day.").max(20).optional(),
        shelterLimit: z.number().int().min(1, "At least 1 meal a day.").max(20).optional(),
        cooldownMinutes: z.number().int().min(0).max(24 * 60).optional(),
      })
      .parse(req.body);
    const before = await hotFoodSettings();
    if (body.supportiveLimit !== undefined) await setSetting("hotFoodsLimitSupportive", String(body.supportiveLimit));
    if (body.shelterLimit !== undefined) await setSetting("hotFoodsLimitShelter", String(body.shelterLimit));
    if (body.cooldownMinutes !== undefined) await setSetting("hotFoodsCooldownMinutes", String(body.cooldownMinutes));
    const after = await hotFoodSettings();
    await audit({
      actor: actorOf(req),
      action: "hotfoods.settings_updated",
      summary: `Hot Foods limits: supportive housing ${after.supportiveLimit}/day, shelters ${after.shelterLimit}/day with a ${after.cooldownMinutes}-minute cooldown (per meal type)`,
      changes: Object.fromEntries(Object.keys(body).map((k) => [k, [before[k as keyof typeof before], after[k as keyof typeof after]]])),
    });
    res.json(after);
  })
);

// ── Recording ────────────────────────────────────────────────────────────

/**
 * Today at a site: entries per resident (the served badges), every meal by
 * type with its time (the per-type limit and cooldown), and the site's rules.
 */
hotFoodsRouter.get(
  "/today",
  requirePermission(RECORD),
  asyncHandler(async (req, res) => {
    const site = await resolveSite(req, req.query.site);
    if (!site) throw badRequest("Choose a site.");
    const [counts, meals, regulars, rules] = await Promise.all([todayCounts(site.id), todayMeals(site.id), regularCounts(site.id), rulesFor(site)]);
    res.json({
      limit: rules.limit,
      cooldownMinutes: rules.cooldownMinutes,
      isShelter: site.siteType === "shelter",
      counts: Object.fromEntries(counts),
      meals: Object.fromEntries([...meals].map(([tenantId, byItem]) => [tenantId, Object.fromEntries(byItem)])),
      regulars: Object.fromEntries(regulars),
      regularsDays: REGULARS_DAYS,
    });
  })
);

const PNG = z
  .string()
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/, "Signature must be a PNG image.")
  .max(400_000)
  .refine((v) => Buffer.from(v.slice("data:image/png;base64,".length), "base64").subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "Signature must be a PNG image.");

const createBody = z.object({
  site: z.string().min(1, "Choose a site."),
  tenantId: z.string().min(1, "Choose a resident."),
  items: z
    .array(z.object({ itemId: z.string().min(1), quantity: z.number().int().min(1).max(20) }))
    .min(1, "Choose at least one item.")
    .max(20),
  notes: z.string().trim().max(500).optional(),
  overrideReason: z.string().trim().max(300).optional(),
  signature: PNG,
  /** The device's id for this entry (see HotFoodEntry.clientId). */
  clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, "Invalid entry id.").optional(),
  /** When the resident signed, by the device's clock. */
  servedAt: z.string().datetime().optional(),
});

/** How far back a saved-on-device entry may still be uploaded. */
const MAX_QUEUE_AGE_MS = 30 * 24 * 3600_000;

const created = (e: { id: string; tenantName: string; mealCount: number }, todayCount: number, limit: number) => ({
  id: e.id, tenantName: e.tenantName, mealCount: e.mealCount, todayCount, limit,
});

hotFoodsRouter.post(
  "/",
  requirePermission(RECORD),
  asyncHandler(async (req, res) => {
    const body = createBody.parse(req.body);
    const site = await resolveSite(req, body.site);
    if (!site) throw badRequest("Choose a site.");
    const rules = await rulesFor(site);
    const limit = rules.limit;

    // A retried upload: hand back what the first attempt recorded.
    if (body.clientId) {
      const prior = await prisma.hotFoodEntry.findFirst({ where: { clientId: body.clientId, createdById: req.user!.userId } });
      if (prior) {
        const n = (await todayCounts(site.id, [prior.tenantId], prior.occurredAt)).get(prior.tenantId) ?? 0;
        res.status(200).json(created(prior, n, limit));
        return;
      }
    }

    // The device's time of signing, never in the future. Queued entries can
    // arrive hours late, and must count toward the day they were served.
    const now = Date.now();
    let occurredAt = new Date(now);
    if (body.servedAt) {
      const t = Date.parse(body.servedAt);
      if (now - t > MAX_QUEUE_AGE_MS) throw badRequest("This entry was saved on the device more than 30 days ago and can't be uploaded.");
      occurredAt = new Date(Math.min(t, now));
    }
    const tenant = await prisma.tenant.findFirst({ where: { id: body.tenantId, siteId: site.id, status: "active" } });
    if (!tenant) throw badRequest("That resident isn't on this site's active roster.");

    const ids = [...new Set(body.items.map((i) => i.itemId))];
    if (ids.length !== body.items.length) throw badRequest("Each item can be listed once — use its quantity instead.");
    const items = await prisma.hotFoodItem.findMany({ where: { id: { in: ids }, active: true } });
    if (items.length !== ids.length) throw badRequest("One of those items is no longer offered. Refresh and try again.");
    const itemById = new Map(items.map((i) => [i.id, i]));

    // The per-type daily limit and the shelter cooldown: breaking either is
    // allowed, but only with a reason on record. An entry from the device's
    // queue has already been signed and handed over (another device, or one
    // that was offline, served them first), so it's recorded with a flag
    // rather than refused.
    const [already, meals] = await Promise.all([
      todayCounts(site.id, [tenant.id], occurredAt).then((m) => m.get(tenant.id) ?? 0),
      todayMeals(site.id, [tenant.id], occurredAt),
    ]);
    const problems = ruleProblems(rules, meals.get(tenant.id), body.items.map((i) => ({ itemId: i.itemId, name: itemById.get(i.itemId)!.name, quantity: i.quantity })), occurredAt);
    let overrideReason = body.overrideReason || null;
    if (problems.length && !overrideReason) {
      if (!body.clientId) {
        throw new HttpError(409, `${displayName(tenant)} needs an override reason: ${problems.join("; ")}.`, { code: "limit", problems, limit });
      }
      overrideReason = `No reason given: ${problems.join("; ")} when this entry uploaded. Review.`;
    }

    const entry = await prisma.hotFoodEntry.create({
      data: {
        siteId: site.id,
        tenantId: tenant.id,
        tenantName: displayName(tenant),
        unit: tenant.unit,
        mealCount: body.items.reduce((n, i) => n + i.quantity, 0),
        notes: body.notes || null,
        overrideReason: problems.length ? overrideReason : null,
        signature: body.signature,
        occurredAt,
        clientId: body.clientId ?? null,
        createdById: req.user!.userId,
        createdByName: req.user!.name,
        items: { create: body.items.map((i) => ({ itemId: i.itemId, itemName: itemById.get(i.itemId)!.name, quantity: i.quantity })) },
      },
    });

    // Being served a meal is the clearest sign someone is still here.
    await recordActivity({ tenantId: tenant.id, source: "hot_foods", label: "Hot Foods", externalRef: entry.id, occurredAt: entry.occurredAt, recordedBy: req.user!.name });

    res.status(201).json(created(entry, already + 1, limit));
  })
);

// ── Reading back ─────────────────────────────────────────────────────────

hotFoodsRouter.get(
  "/",
  requirePermission(READ),
  asyncHandler(async (req, res) => {
    const f = await parseFilter(req, req.query);
    const before = typeof req.query.before === "string" && req.query.before ? req.query.before : undefined;
    res.json(await loadEntries(f, { before, limit: 50 }));
  })
);

const meta = (req: import("express").Request, filter: ExportMeta["filter"]): ExportMeta => ({
  filter,
  isAll: typeof req.query.site !== "string" || req.query.site.trim() === "",
  generatedBy: req.user!.name,
  generatedAt: new Date(),
});

hotFoodsRouter.get(
  "/export",
  requirePermission(READ),
  asyncHandler(async (req, res) => {
    const format = formatOf(req.query.format, "csv");
    const m = meta(req, await parseFilter(req, req.query));
    const items = await loadAllEntries(m.filter);
    const body = format === "csv" ? entriesCsv(m, items) : format === "xlsx" ? await entriesXlsx(m, items) : await entriesPdf(m, items);
    const inline = req.query.inline === "1";
    await audit({
      actor: actorOf(req),
      action: "hotfoods.exported",
      siteId: m.filter.sites.length === 1 ? m.filter.sites[0].id : null,
      summary: `${inline ? "Printed" : `Exported ${format.toUpperCase()} of`} Hot Foods entries — ${scopeLabel({ sites: m.filter.sites, isAll: m.isAll })}, ${m.filter.from} to ${m.filter.to} (${items.length})`,
      changes: { format, from: m.filter.from, to: m.filter.to, q: m.filter.q || undefined, sites: m.filter.sites.map((s) => s.code), count: items.length },
    });
    sendFile(res, format, filename("entries", m, EXPORT_TYPES[format].ext), body, inline);
  })
);

hotFoodsRouter.get(
  "/report",
  requirePermission(READ),
  asyncHandler(async (req, res) => {
    res.json(await buildReport(await parseFilter(req, req.query)));
  })
);

hotFoodsRouter.get(
  "/report/export",
  requirePermission(READ),
  asyncHandler(async (req, res) => {
    const format = formatOf(req.query.format, "pdf");
    if (format === "csv") throw badRequest("The report exports as PDF or Excel.");
    const m = meta(req, await parseFilter(req, req.query));
    const report = await buildReport(m.filter);
    const body = format === "xlsx" ? await reportXlsx(m, report) : await reportPdf(m, report);
    const inline = req.query.inline === "1";
    await audit({
      actor: actorOf(req),
      action: "hotfoods.exported",
      siteId: m.filter.sites.length === 1 ? m.filter.sites[0].id : null,
      summary: `${inline ? "Printed" : `Exported ${format.toUpperCase()} of`} the Hot Foods report — ${scopeLabel({ sites: m.filter.sites, isAll: m.isAll })}, ${m.filter.from} to ${m.filter.to}`,
      changes: { format, report: true, from: m.filter.from, to: m.filter.to, sites: m.filter.sites.map((s) => s.code) },
    });
    sendFile(res, format, filename("report", m, EXPORT_TYPES[format].ext), body, inline);
  })
);

hotFoodsRouter.get(
  "/:id/export",
  requirePermission(READ),
  asyncHandler(async (req, res) => {
    const e = await loadEntryDetail(req, req.params.id);
    await audit({ actor: actorOf(req), action: "hotfoods.exported", siteId: e.site.id, summary: `Printed the Hot Foods entry for ${e.tenantName} at ${e.site.name}` });
    sendFile(res, "pdf", `lantern-hot-foods-${e.site.code}-${e.occurredAt.toISOString().slice(0, 10)}-${e.id}.pdf`, await entryPdf(e), req.query.inline === "1");
  })
);

hotFoodsRouter.get(
  "/:id",
  requirePermission(READ),
  asyncHandler(async (req, res) => {
    res.json(await loadEntryDetail(req, req.params.id));
  })
);

hotFoodsRouter.post(
  "/:id/void",
  requirePermission("entries.void"),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(3, "Say why this entry is being voided.").max(300) }).parse(req.body);
    const e = await loadEntryDetail(req, req.params.id);
    if (e.voidedAt) throw badRequest("This entry is already void.");
    await prisma.hotFoodEntry.update({ where: { id: e.id }, data: { voidedAt: new Date(), voidedById: req.user!.userId, voidedByName: req.user!.name, voidReason: reason } });
    await audit({
      actor: actorOf(req), action: "hotfoods.voided", siteId: e.site.id, tenantId: e.tenantId,
      summary: `Voided the Hot Foods entry for ${e.tenantName} at ${e.site.name} (${e.mealCount} meal${e.mealCount === 1 ? "" : "s"}) — ${reason}`,
      changes: { entryId: e.id, reason },
    });
    res.json(await loadEntryDetail(req, e.id));
  })
);
