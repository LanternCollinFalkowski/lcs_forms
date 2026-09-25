import crypto from "node:crypto";
import { prisma } from "../prisma.js";

/**
 * Outbound webhooks — how WordPress (or Power Automate) hears about roster
 * changes without polling.
 *
 * Each delivery is a POST of `{ id, event, occurredAt, data }` with:
 *   X-Lantern-Event:     tenant.archived
 *   X-Lantern-Delivery:  <uuid>
 *   X-Lantern-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed by the webhook secret>
 *
 * Receivers must verify the signature against the raw body before trusting it.
 * Delivery is at-most-once for the prototype (no retry queue); the receiver
 * can always re-sync from GET /api/v1/roster/changes?since=… — see README.
 */
export const ROSTER_EVENTS = [
  "tenant.created",
  "tenant.updated",
  "tenant.archived",
  "tenant.restored",
  "tenant.kept",
  "tenant.activity",
] as const;
export type RosterEvent = (typeof ROSTER_EVENTS)[number] | "webhook.test";

const TIMEOUT_MS = 5000;

export function sign(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function generateSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("base64url")}`;
}

function subscribes(events: string, event: string) {
  if (event === "webhook.test") return true;
  const list = events.split(",").map((e) => e.trim());
  return list.includes("*") || list.includes(event);
}

export async function deliver(
  hook: { id: string; url: string; secret: string },
  event: RosterEvent,
  data: unknown
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const id = crypto.randomUUID();
  const body = JSON.stringify({ id, event, occurredAt: new Date().toISOString(), data });
  const started = Date.now();
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "LanternRoster-Webhook/1",
        "X-Lantern-Event": event,
        "X-Lantern-Delivery": id,
        "X-Lantern-Signature": sign(hook.secret, body),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const durationMs = Date.now() - started;
  await prisma.$transaction([
    prisma.webhookDelivery.create({ data: { webhookId: hook.id, event, statusCode: status, error, durationMs } }),
    prisma.webhook.update({
      where: { id: hook.id },
      data: { lastDeliveryAt: new Date(), lastStatus: status, lastError: error },
    }),
  ]).catch((e) => console.warn("[webhooks] could not record delivery:", e));
  return { ok: !error, status, error };
}

/** Fire-and-forget fan-out to every active subscriber. Never throws. */
export function emitEvent(event: RosterEvent, data: unknown) {
  void (async () => {
    try {
      const hooks = await prisma.webhook.findMany({ where: { active: true } });
      await Promise.all(hooks.filter((h) => subscribes(h.events, event)).map((h) => deliver(h, event, data)));
    } catch (err) {
      console.warn(`[webhooks] ${event} fan-out failed:`, err);
    }
  })();
}
