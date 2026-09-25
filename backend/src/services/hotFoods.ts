import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../prisma.js";
import { badRequest, notFound } from "../http.js";
import { canAccessSite } from "../auth/middleware.js";
import { TZ } from "./exportCommon.js";
import { sitesInScope, type ScopedSite } from "./siteScope.js";

/**
 * Hot Foods: a meal handed to a resident, signed for on the device. Replaces
 * Gravity Forms form 21. Entries are never edited — a mistake is voided with a
 * reason and recorded again — so a day's count can always be reconstructed.
 */

/**
 * How many times one resident may be served per day at one site before an
 * override reason is required. Same numbers as the WordPress "LCS Duplicate
 * Tenant Check" plugin's settings for this form (site 1, shelter 3); a site
 * counts as a shelter when its type is "shelter" (Admin → Sites).
 */
export const DAILY_LIMIT = { site: 1, shelter: 3 } as const;
export const dailyLimitFor = (site: Pick<ScopedSite, "siteType">) => (site.siteType === "shelter" ? DAILY_LIMIT.shelter : DAILY_LIMIT.site);

/**
 * The meal types the WordPress form's hotfood.csv listed, written once into an
 * empty table. `colorSlot` puts the everyday meals on palette slots 0-2 (the
 * three that stay distinguishable in any combination) and the seasonal ones on
 * 3-4, so the sets that actually occur together always sit on validated,
 * consecutive colors.
 */
const DEFAULT_ITEMS = [
  { name: "Individual Meals", colorSlot: 0, imageUrl: "https://forms.lanterncommunity.org/wp-content/uploads/FoodItems/TogoContainer.webp" },
  { name: "Holiday Meals", colorSlot: 3, imageUrl: "https://forms.lanterncommunity.org/wp-content/uploads/FoodItems/HolidayItem.jpg" },
  { name: "Family Style Meal", colorSlot: 1, imageUrl: "https://forms.lanterncommunity.org/wp-content/uploads/FoodItems/FamilyDinner.webp" },
  { name: "Special Event Meal", colorSlot: 2, imageUrl: "https://forms.lanterncommunity.org/wp-content/uploads/FoodItems/Special.jpg" },
  { name: "Holiday Treats", colorSlot: 4, imageUrl: "https://forms.lanterncommunity.org/wp-content/uploads/FoodItems/cover-collection-holidays.png" },
];

/** Palette slots available to meal types (index.css --viz-1…8). */
export const COLOR_SLOTS = 8;

/** The lowest palette slot no meal type holds yet, or null when all eight are taken. */
export async function nextFreeColorSlot(): Promise<number | null> {
  const used = new Set((await prisma.hotFoodItem.findMany({ select: { colorSlot: true } })).map((i) => i.colorSlot));
  for (let s = 0; s < COLOR_SLOTS; s++) if (!used.has(s)) return s;
  return null;
}

export async function ensureDefaultHotFoodItems(): Promise<boolean> {
  if ((await prisma.hotFoodItem.count()) === 0) {
    await prisma.hotFoodItem.createMany({ data: DEFAULT_ITEMS.map((item, i) => ({ ...item, sortOrder: i })) });
    return true;
  }
  // Meal types from before colors existed: the default slot for a known name, else the next free one.
  const uncolored = await prisma.hotFoodItem.findMany({ where: { colorSlot: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  for (const item of uncolored) {
    const wanted = DEFAULT_ITEMS.find((d) => d.name === item.name)?.colorSlot;
    const taken = wanted !== undefined && (await prisma.hotFoodItem.count({ where: { colorSlot: wanted } })) > 0;
    await prisma.hotFoodItem.update({ where: { id: item.id }, data: { colorSlot: wanted !== undefined && !taken ? wanted : await nextFreeColorSlot() } });
  }
  return false;
}

// ── New York calendar days ───────────────────────────────────────────────
// Lantern's day starts at midnight in New York, whatever the server's zone.

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
});

function nyParts(d: Date) {
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: p.weekday as string };
}

/** New York's offset from UTC at an instant, in ms (negative: -4h or -5h). */
function offsetAt(d: Date) {
  const p = nyParts(d);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
}

/** "2026-09-25" for the New York calendar day an instant falls on. */
export function dayKey(d: Date) {
  const p = nyParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export const isDayKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** The instant New York's day `key` begins. */
export function startOfDay(key: string) {
  const guess = new Date(`${key}T00:00:00Z`);
  // Twice: the offset at midnight can differ from the offset at the guess on a DST day.
  const first = new Date(guess.getTime() - offsetAt(guess));
  return new Date(guess.getTime() - offsetAt(first));
}

export function addDays(key: string, n: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayHour(d: Date) {
  const p = nyParts(d);
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), hour: p.hour };
}

// ── Today at a site ──────────────────────────────────────────────────────

/**
 * Non-void entries per resident at a site on the New York day `at` falls on
 * (default today) — drives the served-today badges and the daily limit.
 */
export async function todayCounts(siteId: string, tenantIds?: string[], at = new Date()) {
  const key = dayKey(at);
  const rows = await prisma.hotFoodEntry.groupBy({
    by: ["tenantId"],
    where: { siteId, occurredAt: { gte: startOfDay(key), lt: startOfDay(addDays(key, 1)) }, voidedAt: null, ...(tenantIds ? { tenantId: { in: tenantIds } } : {}) },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.tenantId, r._count._all]));
}

/** How far back "regulars" look when ordering the Record list. */
export const REGULARS_DAYS = 30;

/**
 * Meals per resident at a site over the REGULARS_DAYS days before today, so
 * the Record list can put the people who come most often first. Today is left
 * out on purpose: the order stays put through a shift instead of shuffling
 * under staff's fingers every time someone is served.
 */
export async function regularCounts(siteId: string) {
  const today = dayKey(new Date());
  const rows = await prisma.hotFoodEntry.groupBy({
    by: ["tenantId"],
    where: { siteId, occurredAt: { gte: startOfDay(addDays(today, -REGULARS_DAYS)), lt: startOfDay(today) }, voidedAt: null },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.tenantId, r._count._all]));
}

// ── Listing ──────────────────────────────────────────────────────────────

export interface EntryFilter {
  sites: ScopedSite[];
  /** Inclusive New York day keys. */
  from: string;
  to: string;
  q: string;
  /** "active" (default) hides voided entries; "void" shows only them; "all" both. */
  status: "active" | "void" | "all";
}

/** Read ?site, ?from, ?to, ?q, ?status off a request, defaulting to the last 30 days. */
export async function parseFilter(req: Request, query: Record<string, unknown>): Promise<EntryFilter> {
  const sites = await sitesInScope(req, query.site);
  const today = dayKey(new Date());
  const to = isDayKey(query.to) ? query.to : today;
  const from = isDayKey(query.from) ? query.from : addDays(to, -29);
  if (from > to) throw badRequest("The start date is after the end date.");
  if (addDays(from, 731) < to) throw badRequest("Choose a range of two years or less.");
  const status = query.status === "void" || query.status === "all" ? query.status : "active";
  return { sites, from, to, q: typeof query.q === "string" ? query.q.trim().slice(0, 100) : "", status };
}

export function whereFor(f: EntryFilter): Prisma.HotFoodEntryWhereInput {
  return {
    siteId: { in: f.sites.map((s) => s.id) },
    occurredAt: { gte: startOfDay(f.from), lt: startOfDay(addDays(f.to, 1)) },
    ...(f.status === "active" ? { voidedAt: null } : f.status === "void" ? { voidedAt: { not: null } } : {}),
    ...(f.q ? { OR: [{ tenantName: { contains: f.q } }, { unit: { contains: f.q } }, { notes: { contains: f.q } }, { createdByName: { contains: f.q } }] } : {}),
  };
}

const LIST_SELECT = {
  id: true, siteId: true, tenantId: true, tenantName: true, unit: true, mealCount: true, notes: true, overrideReason: true,
  occurredAt: true, createdByName: true, voidedAt: true, voidReason: true, source: true,
  items: { select: { itemName: true, quantity: true } },
} satisfies Prisma.HotFoodEntrySelect;

export type EntryRow = Prisma.HotFoodEntryGetPayload<{ select: typeof LIST_SELECT }> & { site: { id: string; code: string; name: string } };

const siteRef = (s: ScopedSite) => ({ id: s.id, code: s.code, name: s.name });

export async function loadEntries(f: EntryFilter, opts: { before?: string; limit?: number } = {}) {
  if (f.sites.length === 0) return { items: [] as EntryRow[], nextBefore: null as string | null, total: 0 };
  const siteById = new Map(f.sites.map((s) => [s.id, s]));
  const where = whereFor(f);
  const limit = opts.limit ?? 50;
  const [rows, total] = await Promise.all([
    prisma.hotFoodEntry.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
      take: limit + 1,
    }),
    opts.before ? Promise.resolve(-1) : prisma.hotFoodEntry.count({ where }),
  ]);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const items = rows.map((r) => ({ ...r, site: siteRef(siteById.get(r.siteId)!) }));
  return { items, nextBefore: hasMore ? items[items.length - 1].id : null, total };
}

/** Every entry matching a filter, for exports. Capped so a runaway export can't exhaust memory. */
export const EXPORT_CAP = 25_000;
export async function loadAllEntries(f: EntryFilter) {
  if (f.sites.length === 0) return [];
  const siteById = new Map(f.sites.map((s) => [s.id, s]));
  const rows = await prisma.hotFoodEntry.findMany({ where: whereFor(f), select: LIST_SELECT, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: EXPORT_CAP + 1 });
  if (rows.length > EXPORT_CAP) throw badRequest(`That's more than ${EXPORT_CAP.toLocaleString()} entries — narrow the dates or sites.`);
  return rows.map((r) => ({ ...r, site: siteRef(siteById.get(r.siteId)!) }));
}

export async function loadEntryDetail(req: Request, id: string) {
  const e = await prisma.hotFoodEntry.findUnique({
    where: { id },
    include: { site: { select: { id: true, code: true, name: true } }, items: { select: { itemName: true, quantity: true } } },
  });
  if (!e || !canAccessSite(req, e.siteId)) throw notFound("Entry not found.");
  return {
    id: e.id, site: e.site, tenantId: e.tenantId, tenantName: e.tenantName, unit: e.unit, mealCount: e.mealCount,
    notes: e.notes, overrideReason: e.overrideReason, signature: e.signature, source: e.source,
    occurredAt: e.occurredAt, createdByName: e.createdByName,
    voidedAt: e.voidedAt, voidedByName: e.voidedByName, voidReason: e.voidReason,
    items: e.items,
  };
}
export type EntryDetail = Awaited<ReturnType<typeof loadEntryDetail>>;

// ── Report ───────────────────────────────────────────────────────────────

/** A meal type as the report charts it. */
export interface ReportSeries {
  /** Item id, or "name:<name>" for an entry whose meal type no longer exists. */
  key: string;
  name: string;
  /**
   * The meal type's own color slot 0-7 (HotFoodItem.colorSlot) — never its
   * rank in this report — so a color always means the same meal on every
   * chart, range and export. Null = "Other" (a meal type that's been removed,
   * or one past the eighth: the palette stops at eight).
   */
  slot: number | null;
}

export interface HotFoodReport {
  from: string;
  to: string;
  sites: { id: string; code: string; name: string }[];
  totals: { entries: number; meals: number; residents: number; overrides: number; voided: number; days: number; avgMealsPerDay: number };
  /** Meal types with at least one meal in range, in slot order. */
  series: ReportSeries[];
  /** `parts[key]` = meals of that type that day. */
  byDay: { day: string; entries: number; meals: number; parts: Record<string, number> }[];
  bySite: { code: string; name: string; siteType: string; entries: number; meals: number; residents: number }[];
  byItem: (ReportSeries & { quantity: number })[];
  /** [weekday 0=Sun][hour 0-23] → meals. */
  heat: number[][];
  /**
   * Who recorded the entries. `avatarColor` is their profile color (null = no
   * account on file, or none chosen — the app's default navy), so a bar matches
   * the avatar people already know them by.
   */
  byStaff: { name: string; entries: number; userId: string | null; avatarColor: string | null }[];
}

/**
 * Everything the Reports tab draws, in one pass over the range. Aggregated in
 * code rather than SQL so it runs unchanged on SQLite and SQL Server; a year
 * of Hot Foods is ~20k small rows, well within what that handles.
 */
export async function buildReport(f: EntryFilter): Promise<HotFoodReport> {
  const active: EntryFilter = { ...f, status: "active" };
  const [rows, voided, allItems] = await Promise.all([
    f.sites.length
      ? prisma.hotFoodEntry.findMany({
          where: whereFor(active),
          select: { siteId: true, tenantId: true, mealCount: true, overrideReason: true, occurredAt: true, createdById: true, createdByName: true, items: { select: { itemId: true, itemName: true, quantity: true } } },
        })
      : Promise.resolve([]),
    f.sites.length ? prisma.hotFoodEntry.count({ where: whereFor({ ...f, status: "void" }) }) : Promise.resolve(0),
    // Hidden ones too: an entry recorded before a meal type was hidden keeps its color.
    prisma.hotFoodItem.findMany({ select: { id: true, name: true, colorSlot: true } }),
  ]);
  const slotOf = new Map(allItems.map((it) => [it.id, it.colorSlot !== null && it.colorSlot < COLOR_SLOTS ? it.colorSlot : null]));
  const nameOf = new Map(allItems.map((it) => [it.id, it.name]));
  const keyOf = (i: { itemId: string | null; itemName: string }) => (i.itemId && slotOf.has(i.itemId) ? i.itemId : `name:${i.itemName}`);

  const days: string[] = [];
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) days.push(d);
  const byDay = new Map(days.map((d) => [d, { day: d, entries: 0, meals: 0, parts: {} as Record<string, number> }]));
  const bySite = new Map(f.sites.map((s) => [s.id, { code: s.code, name: s.name, siteType: s.siteType, entries: 0, meals: 0, residents: new Set<string>() }]));
  const byItem = new Map<string, { name: string; quantity: number }>();
  // Keyed by account, so a person's entries stay together if their name is edited.
  const byStaff = new Map<string, { userId: string | null; name: string; entries: number }>();
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const residents = new Set<string>();
  let meals = 0;
  let overrides = 0;

  for (const r of rows) {
    meals += r.mealCount;
    residents.add(r.tenantId);
    if (r.overrideReason) overrides++;
    const day = byDay.get(dayKey(r.occurredAt));
    if (day) {
      day.entries++;
      day.meals += r.mealCount;
    }
    const site = bySite.get(r.siteId);
    if (site) {
      site.entries++;
      site.meals += r.mealCount;
      site.residents.add(r.tenantId);
    }
    for (const i of r.items) {
      const key = keyOf(i);
      // Current name for a live meal type (renames show everywhere); the snapshot otherwise.
      const name = (i.itemId && nameOf.get(i.itemId)) || i.itemName;
      const cur = byItem.get(key) ?? { name, quantity: 0 };
      cur.quantity += i.quantity;
      byItem.set(key, cur);
      if (day) day.parts[key] = (day.parts[key] ?? 0) + i.quantity;
    }
    const staffKey = r.createdById ?? `name:${r.createdByName}`;
    const staff = byStaff.get(staffKey) ?? { userId: r.createdById, name: r.createdByName, entries: 0 };
    staff.entries++;
    byStaff.set(staffKey, staff);
    const { weekday, hour } = weekdayHour(r.occurredAt);
    heat[weekday][hour] += r.mealCount;
  }

  const seriesOf = (key: string, name: string): ReportSeries => ({ key, name, slot: key.startsWith("name:") ? null : (slotOf.get(key) ?? null) });
  const bySlot = (a: ReportSeries, b: ReportSeries) => (a.slot ?? COLOR_SLOTS) - (b.slot ?? COLOR_SLOTS) || a.name.localeCompare(b.name);
  const series = [...byItem].map(([key, v]) => seriesOf(key, v.name)).sort(bySlot);

  const topStaff = [...byStaff.values()].sort((a, b) => b.entries - a.entries).slice(0, 15);
  const people = await prisma.user.findMany({
    where: { id: { in: topStaff.flatMap((x) => (x.userId ? [x.userId] : [])) } },
    select: { id: true, name: true, avatarColor: true },
  });
  const personById = new Map(people.map((p) => [p.id, p]));

  return {
    from: f.from,
    to: f.to,
    sites: f.sites.map(siteRef),
    totals: { entries: rows.length, meals, residents: residents.size, overrides, voided, days: days.length, avgMealsPerDay: days.length ? meals / days.length : 0 },
    series,
    byDay: [...byDay.values()],
    bySite: [...bySite.values()]
      .map((s) => ({ code: s.code, name: s.name, siteType: s.siteType, entries: s.entries, meals: s.meals, residents: s.residents.size }))
      .sort((a, b) => b.meals - a.meals || a.name.localeCompare(b.name)),
    byItem: [...byItem].map(([key, v]) => ({ ...seriesOf(key, v.name), quantity: v.quantity })).sort((a, b) => b.quantity - a.quantity),
    heat,
    byStaff: topStaff.map((x) => {
      const person = x.userId ? personById.get(x.userId) : undefined;
      return { name: person?.name ?? x.name, entries: x.entries, userId: x.userId, avatarColor: person?.avatarColor ?? null };
    }),
  };
}
