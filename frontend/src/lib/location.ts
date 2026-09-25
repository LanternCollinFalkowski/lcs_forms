import { useCallback, useEffect, useState } from "react";
import type { Site } from "./types";

/**
 * "Which site am I standing at?" — answered entirely on the device. The
 * browser's position is compared with each site's coordinates here and is never
 * sent to the server or stored; the only thing that leaves the phone is the
 * site the person ends up recording at, exactly as if they'd picked it.
 */

/** Must match DEFAULT_GEOFENCE_METERS in backend/src/services/siteLocations.ts. */
export const DEFAULT_GEOFENCE_METERS = 200;

export interface Position {
  latitude: number;
  longitude: number;
  /** Metres, 95% radius as the browser reports it. */
  accuracy: number;
}

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "150 ft" up to a tenth of a mile, then "1.2 mi" — how New Yorkers give distances. */
export function formatDistance(m: number) {
  const feet = m * 3.28084;
  if (feet < 528) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  const miles = m / 1609.344;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

export const hasLocation = (s: Site): s is Site & { latitude: number; longitude: number } => s.latitude != null && s.longitude != null;

export interface SiteDistance {
  site: Site;
  meters: number;
  /** Within the site's radius, allowing for how unsure the fix is (up to 100 m extra). */
  inside: boolean;
}

/** Every located site by distance, nearest first. */
export function sitesByDistance(sites: Site[], pos: Position): SiteDistance[] {
  return sites
    .filter(hasLocation)
    .map((site) => {
      const meters = distanceMeters(pos, site);
      return { site, meters, inside: meters <= (site.geofenceMeters ?? DEFAULT_GEOFENCE_METERS) + Math.min(pos.accuracy, 100) };
    })
    .sort((a, b) => a.meters - b.meters);
}

export type LocateStatus = "idle" | "locating" | "ok" | "denied" | "unavailable";

/**
 * The device's current position, asked for once when `enabled` turns true
 * (the browser shows its own permission prompt the first time) and again on
 * `locate()`. A cached fix up to a minute old is fine — nobody moves sites
 * in a minute.
 */
export function useCurrentPosition(enabled: boolean) {
  const [status, setStatus] = useState<LocateStatus>("idle");
  const [position, setPosition] = useState<Position | null>(null);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation || !window.isSecureContext) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy });
        setStatus("ok");
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
    );
  }, []);

  useEffect(() => {
    if (enabled && status === "idle") locate();
  }, [enabled, status, locate]);

  return { status, position, locate };
}
