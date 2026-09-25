import { prisma } from "../src/prisma.js";
import { addDays, dayKey, startOfDay } from "../src/services/hotFoods.js";
import { displayName } from "../src/services/roster.js";

/**
 * DEMO ONLY — fills the Hot Foods tables with made-up distributions so the
 * Entries and Reports tabs have something to show on a local prototype.
 *
 *   npm run demo:hot-foods            # ~60 days of entries (source "demo")
 *   npm run demo:hot-foods -- --clear # remove every demo entry again
 *
 * Rows are marked source="demo" and never touch the roster's activity log, so
 * clearing them leaves nothing behind. Never run this against production.
 */
if (process.env.NODE_ENV === "production") throw new Error("Refusing to write demo data with NODE_ENV=production.");

// A 1×1 transparent PNG — a stand-in signature.
const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const STAFF = ["Riley Case Worker", "Morgan Site Manager", "Avery Site Admin", "Sam Ortiz", "Dana Lee"];

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

async function main() {
  const removed = await prisma.hotFoodEntry.deleteMany({ where: { source: "demo" } });
  if (removed.count) console.log(`Removed ${removed.count} earlier demo entries.`);
  if (process.argv.includes("--clear")) return;

  const items = await prisma.hotFoodItem.findMany({ orderBy: { sortOrder: "asc" } });
  if (items.length === 0) throw new Error("No meal types yet — start the backend once (or run the seed) first.");
  const byName = new Map(items.map((i) => [i.name, i]));
  const main = byName.get("Individual Meals") ?? items[0];
  const family = byName.get("Family Style Meal") ?? items[0];
  const special = byName.get("Special Event Meal") ?? items[0];

  const sites = await prisma.site.findMany({ where: { active: true }, include: { tenants: { where: { status: "active" }, select: { id: true, firstName: true, lastName: true, preferredName: true, unit: true } } } });
  // Link entries to the demo accounts where the name matches, so reports show their profile colors.
  const userIdByName = new Map((await prisma.user.findMany({ where: { name: { in: STAFF } }, select: { id: true, name: true } })).map((u) => [u.name, u.id]));
  const today = dayKey(new Date());
  const rows: Parameters<typeof prisma.hotFoodEntry.create>[0]["data"][] = [];

  for (const site of sites) {
    if (site.tenants.length === 0) continue;
    // Each site has its own one or two serving days a week and a usual time.
    const servingDays = new Set([Math.floor(rand() * 7), Math.floor(rand() * 7)]);
    const baseHour = pick([12, 12, 13, 17, 18]);
    const shelter = site.siteType === "shelter";
    for (let back = 59; back >= 0; back--) {
      const day = addDays(today, -back);
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      if (!shelter && !servingDays.has(weekday)) continue;
      const turnout = shelter ? 0.08 + rand() * 0.08 : 0.04 + rand() * 0.08;
      const kind = rand() < 0.12 ? family : rand() < 0.05 ? special : main;
      const start = startOfDay(day).getTime();
      for (const t of site.tenants) {
        if (rand() > turnout) continue;
        const at = new Date(start + (baseHour + rand() * 2) * 3600_000);
        if (at > new Date()) continue;
        const qty = kind === main && rand() < 0.08 ? 2 : 1;
        rows.push({
          siteId: site.id, tenantId: t.id, tenantName: displayName(t), unit: t.unit, mealCount: qty,
          notes: qty > 1 ? "Second meal for a household member" : null,
          signature: SIGNATURE, source: "demo", occurredAt: at, createdAt: at, ...(() => { const who = pick(STAFF); return { createdByName: who, createdById: userIdByName.get(who) ?? null }; })(),
          items: { create: [{ itemId: kind.id, itemName: kind.name, quantity: qty }] },
        });
      }
    }
  }

  // Nested creates can't go through createMany; batch the single creates instead.
  for (let i = 0; i < rows.length; i += 200) {
    await prisma.$transaction(rows.slice(i, i + 200).map((data) => prisma.hotFoodEntry.create({ data })));
  }
  console.log(`Wrote ${rows.length} demo Hot Foods entries across ${sites.length} sites (last 60 days).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
