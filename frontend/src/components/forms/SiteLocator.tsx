import { useMemo } from "react";
import { Loader2, MapPin, MapPinOff } from "lucide-react";
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

/**
 * One line under the site picker, only when location needs something from the
 * person: it's off (Try again), or it puts them at a site other than the one
 * picked (Switch to it). While it's looking, and once it has picked the site,
 * the picker itself says so (PickerStatus); being away from every site gets
 * no line at all.
 */
export function LocationHint({ nearby, selectedCode, onPick }: {
  nearby: ReturnType<typeof useNearbySite>;
  selectedCode?: string;
  onPick: (code: string) => void;
}) {
  if (!nearby.enabled) return null;
  const { status, here, locate } = nearby;
  const line = "mt-1.5 flex min-h-[32px] items-center gap-1.5 text-[12.5px]";
  const link = "font-semibold text-accent underline-offset-2 hover:underline dark:text-white";

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
  if (here && here.site.code !== selectedCode) {
    return (
      <p className={`${line} text-muted`}>
        <MapPin className="h-3.5 w-3.5 shrink-0" /> You seem to be at {here.site.name}.{" "}
        <button type="button" onClick={() => onPick(here.site.code)} className={link}>Switch to it</button>
      </p>
    );
  }
  return null;
}

/** True while the picker should read "Finding your location…" instead of a site. */
export const isLocating = (nearby: ReturnType<typeof useNearbySite>) => nearby.enabled && nearby.status === "locating";

/**
 * The icon inside a site picker: a spinner while location is looking, a pin
 * once the device is standing at the picked site. Absolutely placed: give the
 * picker `pl-9` when this returns something (`finding` or pickerHasIcon).
 */
export function PickerStatus({ nearby, finding, selectedCode }: { nearby: ReturnType<typeof useNearbySite>; finding: boolean; selectedCode?: string }) {
  const box = "pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2";
  if (finding) return <span className={`${box} text-muted`}><Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /></span>;
  const here = nearby.here;
  if (!here || here.site.code !== selectedCode) return null;
  return (
    <span className={`${box} text-status-greenText`} title={`You're at ${here.site.name}, ${formatDistance(here.meters)} away`}>
      <MapPin className="h-[18px] w-[18px]" aria-hidden />
      <span className="sr-only">Picked from your location</span>
    </span>
  );
}

/** A pin is showing (the spinner is the caller's `finding`). */
export const pickerHasIcon = (nearby: ReturnType<typeof useNearbySite>, selectedCode?: string) => !!nearby.here && nearby.here.site.code === selectedCode;
