import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { asyncHandler, badRequest } from "../http.js";
import { requireAuth, requirePermission } from "../auth/middleware.js";
import { resolveSite } from "../services/siteScope.js";
import { loadAttendance, loadAttendanceByIds, loadAttendanceDetail, serializeEntry } from "../services/attendance.js";
import { displayName } from "../services/roster.js";
import { detailCsv, detailFilename, detailPdf, detailXlsx, exportFilename, scopeLabel, toCsv, toPdf, toXlsx, type ExportContext } from "../services/attendanceExport.js";
import { actorOf, audit } from "../services/audit.js";

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth);

// ── List ─────────────────────────────────────────────────────────────────

attendanceRouter.get(
  "/",
  requirePermission("roster.view"),
  asyncHandler(async (req, res) => {
    const { items, nextBefore } = await loadAttendance(req, req.query);
    res.json({ items, nextBefore });
  })
);

// ── Export ───────────────────────────────────────────────────────────────

const EXPORT_TYPES = {
  csv: { mime: "text/csv; charset=utf-8", ext: "csv" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  pdf: { mime: "application/pdf", ext: "pdf" },
} as const;

attendanceRouter.get(
  "/export",
  requirePermission("roster.view"),
  asyncHandler(async (req, res) => {
    const format = String(req.query.format ?? "csv") as keyof typeof EXPORT_TYPES;
    if (!(format in EXPORT_TYPES)) throw badRequest("format must be csv, xlsx or pdf.");

    // Exporting a multi-select on the Past attendance list: exactly those
    // entries, not everything matching the current filter.
    const idsParam = typeof req.query.ids === "string" ? req.query.ids.split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (idsParam.length > 500) throw badRequest("Select 500 or fewer entries to export at once.");

    let items: Awaited<ReturnType<typeof loadAttendance>>["items"];
    let sites: Awaited<ReturnType<typeof loadAttendance>>["sites"];
    if (idsParam.length) {
      ({ items, sites } = await loadAttendanceByIds(req, idsParam));
    } else {
      // Walk the same selection as the list, including entries beyond its first page.
      items = [];
      sites = [];
      let before: string | null = null;
      do {
        const page = await loadAttendance(req, { site: req.query.site, q: req.query.q, before, limit: 100 });
        sites = page.sites;
        items.push(...page.items);
        before = page.nextBefore;
      } while (before);
    }
    const ctx: ExportContext = {
      sites,
      isAll: idsParam.length === 0 && (typeof req.query.site !== "string" || req.query.site.trim() === ""),
      q: idsParam.length ? "" : typeof req.query.q === "string" ? req.query.q.trim() : "",
      items,
      generatedBy: req.user!.name,
      generatedAt: new Date(),
    };
    const body = format === "csv" ? toCsv(ctx) : format === "xlsx" ? await toXlsx(ctx) : await toPdf(ctx);
    const type = EXPORT_TYPES[format];
    const filename = exportFilename(ctx, type.ext);

    const printing = req.query.inline === "1";
    await audit({
      actor: actorOf(req),
      action: "attendance.exported",
      siteId: sites.length === 1 ? sites[0].id : null,
      summary: `${printing ? "Printed" : `Exported ${format.toUpperCase()} of`} attendance — ${scopeLabel(ctx)} (${items.length} ${items.length === 1 ? "entry" : "entries"})`,
      changes: { format, q: ctx.q || undefined, sites: sites.map((s) => s.code), count: items.length },
    });

    res.setHeader("Content-Type", type.mime);
    res.setHeader("Content-Disposition", `${printing && format === "pdf" ? "inline" : "attachment"}; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
  })
);

// ── Detail ───────────────────────────────────────────────────────────────

attendanceRouter.get(
  "/:id/export",
  requirePermission("roster.view"),
  asyncHandler(async (req, res) => {
    const format = String(req.query.format ?? "pdf") as keyof typeof EXPORT_TYPES;
    if (!(format in EXPORT_TYPES)) throw badRequest("format must be csv, xlsx or pdf.");
    const event = await loadAttendanceDetail(req, req.params.id);
    const body = format === "csv" ? detailCsv(event) : format === "xlsx" ? await detailXlsx(event) : await detailPdf(event);
    const printing = req.query.inline === "1";
    await audit({
      actor: actorOf(req), action: "attendance.exported", siteId: event.site.id,
      summary: `${printing ? "Printed" : "Exported"} attendance "${event.title}" at ${event.site.name}`,
      changes: { format, attendanceId: event.id, count: event.entries.length },
    });
    res.setHeader("Content-Type", EXPORT_TYPES[format].mime);
    res.setHeader("Content-Disposition", `${printing && format === "pdf" ? "inline" : "attachment"}; filename="${detailFilename(event, format)}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
  })
);

attendanceRouter.get(
  "/:id",
  requirePermission("roster.view"),
  asyncHandler(async (req, res) => {
    res.json(await loadAttendanceDetail(req, req.params.id));
  })
);

// ── Create ───────────────────────────────────────────────────────────────

const createBody = z.object({
  site: z.string().min(1, "Choose a site."),
  title: z.string().trim().min(1, "Title is required.").max(160),
  description: z.string().trim().min(1, "Description is required.").max(2000),
  entries: z
    .array(
      z.object({
        tenantId: z.string().min(1),
        // A signature-pad PNG data URL; bounded well above what a signature
        // actually needs, as a sanity backstop against abuse.
        signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).max(400_000)
          .refine((value) => Buffer.from(value.slice("data:image/png;base64,".length), "base64").subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "Signature must be a PNG image.")
          .optional(),
      })
    )
    .max(1000),
});

attendanceRouter.post(
  "/",
  requirePermission("roster.edit"),
  asyncHandler(async (req, res) => {
    const body = createBody.parse(req.body);
    const site = await resolveSite(req, body.site);
    if (!site) throw badRequest("Choose a site.");

    // Every attendee must be an active resident of this site — attendance
    // can't reference someone it wasn't shown.
    const ids = [...new Set(body.entries.map((e) => e.tenantId))];
    if (ids.length !== body.entries.length) throw badRequest("Each resident can be marked present once.");
    const tenants = ids.length
      ? await prisma.tenant.findMany({ where: { id: { in: ids }, siteId: site.id, status: "active" } })
      : [];
    if (tenants.length !== ids.length) throw badRequest("One or more of those residents aren't on this site's active roster.");
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    const now = new Date();

    const event = await prisma.attendanceEvent.create({
      data: {
        siteId: site.id,
        title: body.title,
        description: body.description,
        occurredAt: now,
        createdById: req.user!.userId,
        createdByName: req.user!.name,
        entries: {
          create: body.entries.map((e) => ({
            tenantId: e.tenantId,
            tenantName: displayName(tenantById.get(e.tenantId)!),
            signature: e.signature ?? null,
            signedAt: e.signature ? now : null,
          })),
        },
      },
      include: { entries: true },
    });

    await audit({
      actor: actorOf(req),
      action: "attendance.taken",
      siteId: site.id,
      summary: `Took attendance "${event.title}" at ${site.name} (${event.entries.length} present, ${event.entries.filter((e) => e.signature).length} signed)`,
      changes: { title: event.title, present: event.entries.length, signed: event.entries.filter((e) => e.signature).length },
    });

    res.status(201).json({
      id: event.id,
      site: { id: site.id, code: site.code, name: site.name },
      title: event.title,
      description: event.description,
      occurredAt: event.occurredAt,
      createdByName: event.createdByName,
      entries: event.entries.map(serializeEntry),
    });
  })
);
