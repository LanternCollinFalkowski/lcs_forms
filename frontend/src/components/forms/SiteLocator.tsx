import { useMemo } from "react";
import { Loader2, LocateFixed, MapPin, MapPinOff } from "lucide-react";
import { formatDistance, hasLocation, sitesByDistance, useCurrentPosition, type SiteDistance } from "@/lib/location";
import type { Site } from "@/lib/types";

/**
 * Site pick-by-location for any form that starts with "which site?". Only
 * worth asking for when the person can choose between two or more sites that
 * have a location on file; with one site there's nothing to pick.
 */
export function useNearbySite(sites: Site[] | undefined) {
  const located = (sites ?? []).filter(hasLocation);
  const enabled = (sites?.length ?? 0) > 1 && located.length > 0;
  const { status, position, locate } = useCurrentPosition(enabled);
  const ranked = useMemo(() => (position ? sitesByDistance(sites ?? [], position) : null), [position, sites]);
  // Neighbouring sites can both be "inside" (some are 30 m apart); the nearer one wins.
  const here = ranked?.find((r) => r.inside) ?? null;
  return { enabled, status, ranked, here, nearest: ranked?.[0] ?? null, locate };
}

/** Site options for a <Select>, nearest first with a distance once the position is known. */
export function siteOptions(sites: Site[], ranked: SiteDistance[] | null) {
  if (!ranked) return sites.map((s) => ({ value: s.code, label: s.name }));
  const dist = new Map(ranked.map((r) => [r.site.code, r.meters]));
  return [...sites]
    .sort((a, b) => (dist.get(a.code) ?? Infinity) - (dist.get(b.code) ?? Infinity) || a.name.localeCompare(b.name))
    .map((s) => ({ value: s.code, label: dist.has(s.code) ? `${s.name} · ${formatDistance(dist.get(s.code)!)}` : s.name }));
}

/** One line under the site picker saying what location did (or why it didn't). */
export function LocationHint({ nearby, selectedCode, onPick }: {
  nearby: ReturnType<typeof useNearbySite>;
  selectedCode?: string;
  onPick: (code: string) => void;
}) {
  if (!nearby.enabled) return null;
  const { status, here, nearest, locate } = nearby;
  const line = "mt-1.5 flex min-h-[32px] items-center gap-1.5 text-[12.5px]";
  const link = "font-semibold text-accent underline-offset-2 hover:underline dark:text-white";

  if (status === "locating") {
    return <p className={`${line} text-muted`}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding the site you're at…</p>;
  }
  if (status === "denied" || status === "unavailable") {
    return (
      <p className={`${line} text-muted`}>
        <MapPinOff className="h-3.5 w-3.5 shrink-0" />
        <span>
          {status === "denied" ? "Location is off for this site, so pick yours above." : "Couldn't get your location — pick your site above."}{" "}
          <button type="button" onClick={locate} className={link}>Try again</button>
        </span>
      </p>
    );
  }
  if (status !== "ok") return null;
  if (here) {
    return here.site.code === selectedCode ? (
      <p className={`${line} text-status-greenText`}>
        <MapPin className="h-3.5 w-3.5 shrink-0" /> You're at <span className="font-semibold">{here.site.name}</span> · {formatDistance(here.meters)} away
      </p>
    ) : (
      <p className={`${line} text-muted`}>
        <MapPin className="h-3.5 w-3.5 shrink-0" /> You seem to be at {here.site.name}.{" "}
        <button type="button" onClick={() => onPick(here.site.code)} className={link}>Switch to it</button>
      </p>
    );
  }
  if (nearest) {
    return (
      <p className={`${line} text-muted`}>
        <LocateFixed className="h-3.5 w-3.5 shrink-0" />
        <span>
          Not at any of your sites — nearest is {nearest.site.name}, {formatDistance(nearest.meters)} away.{" "}
          {nearest.site.code !== selectedCode && <button type="button" onClick={() => onPick(nearest.site.code)} className={link}>Use it</button>}
        </span>
      </p>
    );
  }
  return null;
}
