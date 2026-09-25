import {
  Briefcase, Bus, Calendar, ClipboardList, File, Folder, Heart, Home, Monitor, Package, Shield, Users, Utensils, Wallet,
} from "lucide-react";
import type { PermissionKey } from "./types";

/**
 * Icons a form category can wear. The keys are stored in the database, so this
 * list must match FORM_ICONS in backend/src/routes/forms.ts: add to both, and
 * never rename a key that is in use.
 */
export const FORM_ICONS = {
  folder: { label: "Folder", Icon: Folder },
  utensils: { label: "Food", Icon: Utensils },
  users: { label: "People", Icon: Users },
  bus: { label: "Transport", Icon: Bus },
  wallet: { label: "Money", Icon: Wallet },
  shield: { label: "Security", Icon: Shield },
  briefcase: { label: "Work", Icon: Briefcase },
  monitor: { label: "Computer", Icon: Monitor },
  home: { label: "Home", Icon: Home },
  heart: { label: "Care", Icon: Heart },
  calendar: { label: "Calendar", Icon: Calendar },
  clipboard: { label: "Clipboard", Icon: ClipboardList },
  package: { label: "Package", Icon: Package },
  file: { label: "Document", Icon: File },
} as const;

export type FormIconKey = keyof typeof FORM_ICONS;

export function formIcon(key: string) {
  return (FORM_ICONS[key as FormIconKey] ?? FORM_ICONS.folder).Icon;
}

/** A form built into this app ("/roster") rather than a link out to WordPress. */
export function isInternalForm(url: string) {
  return url.startsWith("/") && !url.startsWith("//");
}

/**
 * App paths a catalog entry can point at that need more than a session. The
 * Forms screen shows such a card locked, and the sidebar leaves it out, rather
 * than offering a link that just bounces the person back to Forms.
 */
const ROSTER_HINT = "You need roster access for this. Ask an administrator to give you a roster role.";
const INTERNAL_NEEDS: { prefix: string; anyOf: PermissionKey[]; hint: string }[] = [
  { prefix: "/roster", anyOf: ["roster.view"], hint: ROSTER_HINT },
  { prefix: "/tenants", anyOf: ["roster.view"], hint: ROSTER_HINT },
  // Recording needs roster.edit; Main Office can still read entries and reports.
  { prefix: "/forms/hot-foods", anyOf: ["roster.edit", "entries.view"], hint: "You need a site role to record Hot Foods. Ask an administrator." },
];

export function formNeeds(url: string) {
  if (!isInternalForm(url)) return undefined;
  return INTERNAL_NEEDS.find((n) => url.startsWith(n.prefix));
}

/** Can this person open the form at `url`? */
export function canOpenForm(url: string, can: (p: PermissionKey) => boolean) {
  const needs = formNeeds(url);
  return !needs || needs.anyOf.some(can);
}
