import { NavLink, useLocation } from "react-router-dom";
import { FileText, Users, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import type { PermissionKey } from "@/lib/types";
import { useReviewCount } from "./Sidebar";

/**
 * The phone's navigation, the same three destinations as the sidebar: Forms,
 * the Roster (whose screens are tabs inside it, see SectionTabs) and More for
 * Admin and Profile. Every role today can see a roster; Roster only drops out
 * for one that can't.
 */
const TABS: {
  to: string;
  label: string;
  icon: typeof Users;
  needs: PermissionKey[];
  /** Extra path prefixes that light this tab. */
  alsoActiveFor?: string[];
  exact?: boolean;
}[] = [
  { to: "/forms", label: "Forms", icon: FileText, needs: [] },
  { to: "/roster", label: "Roster", icon: Users, needs: ["roster.view"], alsoActiveFor: ["/tenants"] },
  {
    to: "/more",
    label: "More",
    icon: Menu,
    // No permission gate: More always holds at least Profile.
    needs: [],
    alsoActiveFor: ["/admin", "/profile"],
  },
];

export function MobileTabBar() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const waiting = useReviewCount();

  const visible = TABS.filter((t) => t.needs.length === 0 || t.needs.some((p) => can(p)));

  return (
    <nav
      aria-label="Main"
      // pb-safe-bottom: the site-wide bottom inset, so the tabs never sit on
      // the swipe-home bar (see --tabbar-bottom in index.css).
      className="flex-none border-t border-hairline bg-surface px-2 pb-safe-bottom pt-1.5 md:hidden"
    >
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
      >
        {visible.map((tab) => {
          const alsoActive = tab.alsoActiveFor?.some((prefix) => pathname.startsWith(prefix)) ?? false;
          const badge = tab.to === "/roster" ? waiting : 0;
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.exact}
              className={({ isActive }) =>
                cn(
                  "relative flex min-h-[50px] flex-col items-center justify-center gap-[3px] rounded-input transition-colors",
                  isActive || alsoActive ? "bg-navsel text-accent dark:text-white" : "text-muted"
                )
              }
            >
              <tab.icon className="h-[22px] w-[22px]" />
              <span className="text-[10.5px] font-bold">{tab.label}</span>
              {badge > 0 && (
                <span
                  aria-label={`${badge} to review`}
                  className="absolute top-1 left-[calc(50%+8px)] flex h-[17px] min-w-[17px] items-center justify-center rounded-pill bg-status-amberDot px-1 text-[10px] font-extrabold text-white"
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
