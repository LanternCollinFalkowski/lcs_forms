import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";

const THEME_COLORS = {
  lantern: "#6baac4",
  ocean: "#0e7490",
  plum: "#6d2873",
  forest: "#166534",
} as const;

const toHex = (bytes: number[]) => `#${bytes.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const channels = (hex: string) => hex.slice(1).match(/.{2}/g)!.map((v) => parseInt(v, 16));

function darker(hex: string) {
  return toHex(channels(hex).map((value) => Math.round(value * 0.56)));
}

/**
 * The two fills need to read as one family, the way the original navy #2c3453
 * and light blue #6baac4 do. A theme's own colour is its *dark* brand shade
 * (Ocean is #0e7490, Plum #6d2873), so using it unchanged as the light fill
 * left the mark reading flat and heavy. Blending halfway to white puts the
 * light fill at roughly the lightness the original artwork uses.
 */
function lighter(hex: string) {
  return toHex(channels(hex).map((value) => Math.round(value + (255 - value) * 0.5)));
}

/** Recolors the two fills in the original logo without changing its artwork. */
export function ThemedLogo() {
  const { theme, customThemeColor, dark } = usePrefs();
  const [src, setSrc] = useState("/lcs_logo_color.svg");
  // Both fills derive from the theme colour: the outline is it darkened (which
  // is what it has always been), the light fill is it lightened.
  const base = theme === "custom" ? customThemeColor : THEME_COLORS[theme];
  const light = dark ? "#dedede" : lighter(base);
  const outline = dark ? "#8a8a8a" : darker(base);

  // The Lantern theme IS the brand palette, so the mark is served exactly as
  // drawn. Recolouring it here would keep the light blue but derive the outline
  // from it — turning the brand navy #2c3453 into a washed teal.
  const asDrawn = !dark && theme === "lantern";

  useEffect(() => {
    if (asDrawn) {
      setSrc("/lcs_logo_color.svg");
      return;
    }
    let cancelled = false;
    fetch("/lcs_logo_color.svg")
      .then((response) => response.text())
      .then((svg) => {
        if (!cancelled) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/#2c3453/gi, outline).replace(/#6baac4/gi, light))}`);
      })
      .catch(() => { if (!cancelled) setSrc("/lcs_logo_color.svg"); });
    return () => { cancelled = true; };
  }, [light, outline, asDrawn]);

  return <img src={src} alt="Lantern Community Services" className="h-11 w-auto max-w-none shrink-0" />;
}
