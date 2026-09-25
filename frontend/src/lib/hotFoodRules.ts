import type { HotFoodItem } from "./types";
import type { QueuedEntry } from "./hotFoodsQueue";

/**
 * The Hot Foods rules as the Record screen applies them, mirroring the server's
 * ruleProblems (backend services/hotFoods.ts) so a reason is asked for before
 * Save instead of the upload being flagged later. Per meal type: `limit` meals
 * a day, and at a shelter `cooldownMinutes` between two of the same type.
 */
export interface Rules {
  limit: number;
  cooldownMinutes: number;
}

/** itemId → one timestamp (ms) per meal of that type today. */
export type Served = Record<string, number[]>;

export interface Problem {
  itemId: string;
  kind: "limit" | "cooldown";
  text: string;
}

export function ruleProblems(rules: Rules, served: Served | undefined, cart: Record<string, number>, items: HotFoodItem[], now = Date.now()): Problem[] {
  const window = rules.cooldownMinutes * 60_000;
  const out: Problem[] = [];
  for (const item of items) {
    const qty = cart[item.id] ?? 0;
    if (!qty) continue;
    const times = served?.[item.id] ?? [];
    if (times.length + qty > rules.limit) {
      out.push({ itemId: item.id, kind: "limit", text: `${item.name}: ${times.length} today already (limit ${rules.limit} a day)` });
      continue;
    }
    if (!window) continue;
    const wait = cooldownLeft(rules, times, now);
    if (wait > 0) out.push({ itemId: item.id, kind: "cooldown", text: `${item.name}: last one ${minutes(window - wait)} ago (${rules.cooldownMinutes}-minute cooldown)` });
    else if (qty > 1) out.push({ itemId: item.id, kind: "cooldown", text: `${item.name}: ${qty} at once (${rules.cooldownMinutes}-minute cooldown between meals)` });
  }
  return out;
}

/** Ms until the cooldown on this meal type ends; 0 = none running. */
export function cooldownLeft(rules: Rules, times: number[], now = Date.now()) {
  if (!rules.cooldownMinutes || times.length === 0) return 0;
  return Math.max(0, Math.max(...times) + rules.cooldownMinutes * 60_000 - now);
}

export const minutes = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`;
};

/** Today's meals from the server plus this device's entries still waiting to upload. */
export function mealsWithQueued(meals: Record<string, Served>, queued: QueuedEntry[], siteCode: string | undefined) {
  if (!siteCode) return meals;
  const today = new Date().toDateString();
  const out: Record<string, Served> = {};
  for (const [t, byItem] of Object.entries(meals)) out[t] = { ...byItem };
  for (const q of queued) {
    if (q.siteCode !== siteCode || new Date(q.savedAt).toDateString() !== today) continue;
    const byItem = (out[q.tenantId] ??= {});
    for (const line of q.body.items) byItem[line.itemId] = [...(byItem[line.itemId] ?? []), ...Array<number>(line.quantity).fill(q.savedAt)];
  }
  return out;
}
