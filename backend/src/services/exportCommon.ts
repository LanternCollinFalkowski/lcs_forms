/**
 * The parts of an export/print pipeline that have nothing to do with what's
 * being exported — shared by `rosterExport.ts` and `attendanceExport.ts`.
 */

/** Lantern's sites are in New York; the server may not be (Azure runs in UTC). */
export const TZ = "America/New_York";
export const stamp = (d: Date) => d.toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });

export interface ScopeContext {
  sites: { name: string }[];
  /** Every site the person could have picked — to say "All my sites" honestly. */
  isAll: boolean;
}

export function scopeLabel(ctx: ScopeContext) {
  if (ctx.sites.length === 1) return ctx.sites[0].name;
  if (ctx.isAll) return "All my sites";
  // Name a short selection outright; a printout that says "3 sites" doesn't say which.
  if (ctx.sites.length <= 3) {
    const names = ctx.sites.map((s) => s.name);
    return names.length === 2 ? names.join(" & ") : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  }
  return `${ctx.sites.length} sites`;
}
