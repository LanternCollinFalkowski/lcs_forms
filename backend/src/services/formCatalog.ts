import { prisma } from "../prisma.js";
import { getSetting, setSetting } from "./settings.js";

/**
 * The Forms screen's starting catalog: every form linked from
 * forms.lanterncommunity.org (home page and /encounter-forms/) as of v1, in the
 * same groups staff already know. After the first write, the catalog belongs
 * to admins (Admin → Forms catalog); nothing here overwrites their edits.
 *
 * `url` is either a WordPress page (the form still lives there) or an app path
 * for a form rebuilt inside this site. The Tenant Updater is the first of
 * those: it is now the roster. Hot Foods is the second (/forms/hot-foods).
 */
const WP = "https://forms.lanterncommunity.org";

interface DefaultForm {
  title: string;
  description?: string;
  url: string;
  keywords?: string;
  badge?: string;
}

export const DEFAULT_CATALOG: { name: string; icon: string; forms: DefaultForm[] }[] = [
  {
    name: "Pantry Forms",
    icon: "utensils",
    forms: [
      { title: "Pantry Form", description: "Record a food pantry visit.", url: `${WP}/encounter-forms/pantry-form/`, keywords: "food, pantry" },
      { title: "Hot Foods Form", description: "Record a hot meal handed to a resident, with their signature.", url: "/forms/hot-foods", keywords: "food, meal, hot foods, prepared food" },
      { title: "Instacart Form", description: "Log an Instacart order.", url: `${WP}/instacart_form/`, keywords: "food, groceries, delivery" },
      { title: "Inventory Reporting Form", description: "Report pantry stock levels.", url: `${WP}/encounter-forms/inventory-reporting/`, keywords: "stock, supplies" },
    ],
  },
  {
    name: "Client / Tenant Services",
    icon: "users",
    forms: [
      {
        title: "Roster",
        description: "Add, update and remove residents at your sites. Replaces the Tenant Updater form.",
        url: "/roster",
        keywords: "tenant updater, tenant, resident, move in, move out, roster",
        badge: "New",
      },
      { title: "Content Release Form", description: "Consent to use a photo, video or story.", url: `${WP}/content-release-form/`, keywords: "consent, photo, media release" },
      { title: "Incentive/Distribution Form", description: "Record incentives or items given to residents.", url: `${WP}/incentive-form/`, keywords: "incentive, gift card, distribution" },
      { title: "Unit Inspection Form", description: "Inspect a unit. Add a comment for anything missing or not working.", url: `${WP}/encounter-forms/unit-inspection-form/`, keywords: "inspection, apartment, unit" },
      { title: "Encounter Event Form", description: "Record an event held with residents.", url: `${WP}/encounter-forms/encounter-event-form/`, keywords: "event, encounter, attendance" },
      { title: "LCS Event Request Form", description: "Request an event.", url: `${WP}/lcs-event-request-form/`, keywords: "event request" },
    ],
  },
  {
    name: "Transportation & Travel",
    icon: "bus",
    forms: [
      { title: "Metro Card Reconciliation Form (Reports)", description: "Reconcile MetroCards handed out to residents.", url: `${WP}/encounter-forms/tenant-metro-check-out/`, keywords: "metrocard, metro card, transit, reconciliation" },
      { title: "Metro Card Main Office Pickup", description: "Pick up MetroCards from the main office.", url: `${WP}/encounter-forms/metro-card/`, keywords: "metrocard, metro card, transit, pickup" },
    ],
  },
  {
    name: "Finance & Cash Handling",
    icon: "wallet",
    forms: [
      { title: "Rent Collection Form", description: "Document tenant rent payments per policy.", url: `${WP}/encounter-forms/rent-collection/`, keywords: "rent, payment, money order" },
      { title: "Petty Cash Replenishment Request Form", description: "Request a petty cash top-up.", url: `${WP}/encounter-forms/petty-cash-replenishment-request/`, keywords: "petty cash, replenish" },
      { title: "Petty Cash Report Form", description: "Report petty cash spending.", url: `${WP}/encounter-forms/petty-cash-report/`, keywords: "petty cash, receipts" },
    ],
  },
  {
    name: "Security & Compliance",
    icon: "shield",
    forms: [
      { title: "Security Drop Form", description: "Log a security drop.", url: `${WP}/encounter-forms/security-drop/`, keywords: "security" },
      { title: "Incident Report", description: "Report an incident at a site.", url: `${WP}/incident-reports/`, keywords: "incident, accident, emergency" },
    ],
  },
  {
    name: "Staff & HR",
    icon: "briefcase",
    forms: [
      { title: "Content Submission Form", description: "Nominate someone, or an event, for a newsletter spotlight.", url: `${WP}/content_submission_form/`, keywords: "newsletter, spotlight, marketing" },
      { title: "Lantern Onboarding Form", description: "HR onboarding for new staff.", url: `${WP}/hr-forms/`, keywords: "hr, onboarding, new hire", badge: "Password required" },
      { title: "Lantern Safety Form", description: "Raise a workplace safety concern.", url: `${WP}/safetyform/`, keywords: "safety, hazard" },
      { title: "ER Form", description: "Employee relations.", url: `${WP}/er-form/`, keywords: "employee relations, hr" },
    ],
  },
  {
    name: "IT & Equipment",
    icon: "monitor",
    forms: [
      { title: "Tech Pickup Form", description: "Pick up a laptop, phone or other equipment.", url: `${WP}/encounter-forms/tech-pickup/`, keywords: "laptop, phone, equipment, it" },
      { title: "Lantern Help Desk", description: "Ask IT for help.", url: `${WP}/lantern-helpdesk/`, keywords: "help desk, it, ticket, support, zendesk" },
    ],
  },
  {
    name: "Submissions & Requests",
    icon: "folder",
    forms: [
      {
        title: "View Past Submissions",
        description: "Encounter form submissions, in SharePoint.",
        url: "https://lanterncommunityorg.sharepoint.com/:u:/s/LanternProcurementPortal/IQABJoeGXFCETYkgZP7jmG76AXXSWZFFlW4sh8aws1ozbFE?e=WyhwYy",
        keywords: "history, sharepoint, past, entries",
      },
      { title: "My Help Desk Requests", description: "Tickets you've sent to the help desk.", url: "https://lanterncommunity.zendesk.com/hc/en-us/requests", keywords: "zendesk, tickets, help desk" },
    ],
  },
];

/**
 * Write the default catalog, once. Guarded by a setting rather than "is the
 * table empty", so an admin who deliberately clears the catalog doesn't get it
 * back on the next restart.
 */
export async function ensureDefaultCatalog(): Promise<boolean> {
  if (await getSetting("formCatalogSeeded")) return false;
  if ((await prisma.formCategory.count()) === 0) {
    for (const [ci, cat] of DEFAULT_CATALOG.entries()) {
      await prisma.formCategory.create({
        data: {
          name: cat.name,
          icon: cat.icon,
          sortOrder: ci,
          forms: { create: cat.forms.map((f, fi) => ({ ...f, sortOrder: fi })) },
        },
      });
    }
  }
  await setSetting("formCatalogSeeded", new Date().toISOString());
  return true;
}
