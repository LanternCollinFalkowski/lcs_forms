import { Prisma, type AttendanceEntry } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../prisma.js";
import { badRequest, notFound } from "../http.js";
import { canAccessSite } from "../auth/middleware.js";
import { sitesInScope, type ScopedSite } from "./siteScope.js";

/**
 * Attendance: who showed up to a session at a site, and — optionally — their
 * signature captured on the spot. Append-only, the same philosophy as the
 * audit log: nothing here is edited or deleted, a mistake is fixed by taking
 * attendance again.
 */

const siteRef = (s: ScopedSite) => ({ id: s.id, code: s.code, name: s.name });

export interface AttendanceListItem {
  id: string;
  siteId: string;
  site: { id: string; code: string; name: string };
  title: string;
  description: string;
  occurredAt: Date;
  createdByName: string;
  presentCount: number;
  signedCount: number;
}

/** A page fits comfortably on one screen; "load more" asks for another. */
const PAGE_CAP = 100;

/**
 * Past attendance events the caller can see, newest first, optionally
 * filtered to a site selection and a title/description search. Counts are one
 * grouped query across every event on the page, not one query per event — see
 * the same fix just made to `routes/sites.ts` and `routes/activity.ts` for why
 * that matters once there are more than a handful of rows.
 */
export async function loadAttendance(
  req: Request,
  opts: { site?: unknown; q?: unknown; before?: unknown; limit?: unknown }
): Promise<{ sites: ScopedSite[]; items: AttendanceListItem[]; nextBefore: string | null }> {
  const sites = await sitesInScope(req, opts.site);
  if (sites.length === 0) return { sites, items: [], nextBefore: null };
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const q = typeof opts.q === "string" ? opts.q.trim() : "";
  const requestedLimit = Number(opts.limit ?? 50);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw badRequest("limit must be a positive integer.");
  const limit = Math.min(requestedLimit, PAGE_CAP);
  const before = typeof opts.before === "string" && opts.before ? opts.before : undefined;
  if (before) {
    const cursor = await prisma.attendanceEvent.findUnique({ where: { id: before }, select: { siteId: true } });
    if (!cursor || !siteById.has(cursor.siteId)) throw badRequest("Invalid attendance cursor.");
  }

  const events = await prisma.attendanceEvent.findMany({
    where: {
      siteId: { in: sites.map((s) => s.id) },
      ...(q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    take: limit + 1,
  });

  const hasMore = events.length > limit;
  if (hasMore) events.pop();

  const ids = events.map((e) => e.id);
  const counts = ids.length
    ? await prisma.$queryRaw<{ eventId: string; present: bigint | number; signed: bigint | number }[]>`
        SELECT eventId, COUNT(*) as present, SUM(CASE WHEN signature IS NOT NULL THEN 1 ELSE 0 END) as signed
        FROM AttendanceEntry WHERE eventId IN (${Prisma.join(ids)}) GROUP BY eventId`
    : [];
  const countBy = new Map(counts.map((c) => [c.eventId, { present: Number(c.present), signed: Number(c.signed) }]));

  const items: AttendanceListItem[] = events.map((e) => ({
    id: e.id,
    siteId: e.siteId,
    site: siteRef(siteById.get(e.siteId)!),
    title: e.title,
    description: e.description,
    occurredAt: e.occurredAt,
    createdByName: e.createdByName,
    presentCount: countBy.get(e.id)?.present ?? 0,
    signedCount: countBy.get(e.id)?.signed ?? 0,
  }));

  return { sites, items, nextBefore: hasMore ? items[items.length - 1].id : null };
}

/**
 * A specific set of attendance events by id, scoped to sites the caller can
 * see — used to export exactly what was multi-selected in Past attendance,
 * rather than everything matching the current filter.
 */
export async function loadAttendanceByIds(req: Request, ids: string[]): Promise<{ sites: ScopedSite[]; items: AttendanceListItem[] }> {
  const sites = await sitesInScope(req, undefined);
  if (sites.length === 0 || ids.length === 0) return { sites: [], items: [] };
  const siteById = new Map(sites.map((s) => [s.id, s]));

  const events = await prisma.attendanceEvent.findMany({
    where: { id: { in: ids }, siteId: { in: sites.map((s) => s.id) } },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  });

  const eventIds = events.map((e) => e.id);
  const counts = eventIds.length
    ? await prisma.$queryRaw<{ eventId: string; present: bigint | number; signed: bigint | number }[]>`
        SELECT eventId, COUNT(*) as present, SUM(CASE WHEN signature IS NOT NULL THEN 1 ELSE 0 END) as signed
        FROM AttendanceEntry WHERE eventId IN (${Prisma.join(eventIds)}) GROUP BY eventId`
    : [];
  const countBy = new Map(counts.map((c) => [c.eventId, { present: Number(c.present), signed: Number(c.signed) }]));

  const items: AttendanceListItem[] = events.map((e) => ({
    id: e.id,
    siteId: e.siteId,
    site: siteRef(siteById.get(e.siteId)!),
    title: e.title,
    description: e.description,
    occurredAt: e.occurredAt,
    createdByName: e.createdByName,
    presentCount: countBy.get(e.id)?.present ?? 0,
    signedCount: countBy.get(e.id)?.signed ?? 0,
  }));

  const usedSites = [...new Map(items.map((i) => [i.site.id, siteById.get(i.site.id)!])).values()];
  return { sites: usedSites, items };
}

export function serializeEntry(e: AttendanceEntry) {
  return {
    id: e.id,
    tenantId: e.tenantId,
    tenantName: e.tenantName,
    signature: e.signature,
    signedAt: e.signedAt,
  };
}

export async function loadAttendanceDetail(req: Request, id: string) {
  const event = await prisma.attendanceEvent.findUnique({
    where: { id },
    include: { site: { select: { id: true, code: true, name: true } }, entries: { orderBy: { createdAt: "asc" } } },
  });
  if (!event || !canAccessSite(req, event.siteId)) throw notFound("Attendance entry not found.");
  return {
    id: event.id,
    site: event.site,
    title: event.title,
    description: event.description,
    occurredAt: event.occurredAt,
    createdByName: event.createdByName,
    entries: event.entries.map(serializeEntry),
  };
}
