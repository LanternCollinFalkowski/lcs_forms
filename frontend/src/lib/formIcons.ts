import {
  Banknote, Boxes, Briefcase, Bus, Calendar, CalendarPlus, Camera, ClipboardList, Contact, File, Folder, Gift, HardHat, Heart,
  History, Home, Inbox, Laptop, LifeBuoy, Lock, MessageSquare, Monitor, Newspaper, Package, PartyPopper, PiggyBank, Receipt,
  SearchCheck, Shield, ShoppingBasket, ShoppingCart, Soup, Ticket, TrainFront, TriangleAlert, UserPlus, Users, Utensils, Wallet,
} from "lucide-react";
import type { PermissionKey } from "./types";

/**
 * Icons a form category or a form can wear. The keys are stored in the
 * database, so this list must match FORM_ICONS in backend/src/routes/forms.ts:
 * add to both, and never rename a key that is in use.
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
  basket: { label: "Pantry", Icon: ShoppingBasket },
  soup: { label: "Hot meal", Icon: Soup },
  cart: { label: "Groceries", Icon: ShoppingCart },
  boxes: { label: "Inventory", Icon: Boxes },
  contact: { label: "Roster", Icon: Contact },
  camera: { label: "Photo", Icon: Camera },
  gift: { label: "Gift", Icon: Gift },
  inspect: { label: "Inspection", Icon: SearchCheck },
  party: { label: "Event", Icon: PartyPopper },
  "calendar-plus": { label: "Request", Icon: CalendarPlus },
  train: { label: "Transit", Icon: TrainFront },
  ticket: { label: "Ticket", Icon: Ticket },
  banknote: { label: "Cash", Icon: Banknote },
  "piggy-bank": { label: "Savings", Icon: PiggyBank },
  receipt: { label: "Receipt", Icon: Receipt },
  lock: { label: "Lock", Icon: Lock },
  alert: { label: "Incident", Icon: TriangleAlert },
  newspaper: { label: "Newsletter", Icon: Newspaper },
  "user-plus": { label: "New person", Icon: UserPlus },
  "hard-hat": { label: "Safety", Icon: HardHat },
  message: { label: "Conversation", Icon: MessageSquare },
  laptop: { label: "Laptop", Icon: Laptop },
  help: { label: "Help", Icon: LifeBuoy },
  history: { label: "History", Icon: History },
  inbox: { label: "Inbox", Icon: Inbox },
} as const;

export type FormIconKey = keyof typeof FORM_ICONS;

export function formIcon(key: string) {
  return (FORM_ICONS[key as FormIconKey] ?? FORM_ICONS.folder).Icon;
}

/** A form's own icon, or its category's when it has none. */
export function formLinkIcon(form: { icon?: string | null }, categoryIcon: string) {
  return formIcon(form.icon && form.icon in FORM_ICONS ? form.icon : categoryIcon);
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
