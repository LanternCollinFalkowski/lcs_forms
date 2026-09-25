import type { Request } from "express";
import { prisma } from "../prisma.js";
import { emitEvent, type RosterEvent } from "./webhooks.js";

export interface Actor {
  id: string | null;
  name: string;
}

export function actorOf(req: Request): Actor {
  if (req.user) return { id: req.user.userId, name: req.user.name };
  if (req.apiKey) return { id: null, name: `API key: ${req.apiKey.name}` };
  return { id: null, name: "System" };
}

/** { field: [before, after] } for the fields that actually changed. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>, fields: (keyof T)[]) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const f of fields) {
    if (!(f in after)) continue;
    const a = normalise(before[f]);
    const b = normalise(after[f]);
    if (a !== b) out[f as string] = [a, b];
  }
  return out;
}

function normalise(v: unknown) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v === undefined || v === "") return null;
  return v;
}

/**
 * Record an audit event and, when it is a roster event, fan it out to
 * webhooks. The audit write is awaited; delivery is fire-and-forget so a slow
 * WordPress endpoint never slows a swipe.
 */
export async function audit(opts: {
  actor: Actor;
  action: string;
  summary: string;
  tenantId?: string | null;
  siteId?: string | null;
  changes?: unknown;
  /** Payload for outbound webhooks. Omit for non-roster events. */
  webhook?: { event: RosterEvent; data: unknown };
}) {
  await prisma.auditEvent.create({
    data: {
      actorId: opts.actor.id,
      actorName: opts.actor.name,
      action: opts.action,
      summary: opts.summary,
      tenantId: opts.tenantId ?? null,
      siteId: opts.siteId ?? null,
      changes: opts.changes === undefined ? null : JSON.stringify(opts.changes),
    },
  });
  if (opts.webhook) emitEvent(opts.webhook.event, opts.webhook.data);
}
