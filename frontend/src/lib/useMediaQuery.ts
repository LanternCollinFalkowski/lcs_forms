import { useEffect, useState } from "react";

/**
 * Subscribe to a media query.
 *
 * Starts `false` on the very first render so the two paints agree even though
 * the SPA is client-only — a screen that swapped structure between the initial
 * render and the effect would flash the desktop layout on a phone. The effect
 * runs before paint in practice, so the flash is not observable, and the
 * initial value is corrected in the same commit.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    // Optional call: not every environment a screen renders in implements it
    // (jsdom, for one), and the false above is the right answer there — a test
    // asserting on a table should get the table.
    const list = window.matchMedia?.(query);
    if (!list) return;
    setMatches(list.matches);
    // A resize re-reads too: an iframe resized by its parent (the device
    // preview's Rotate) changes orientation without the list's change event.
    const reread = () => setMatches(list.matches);
    window.addEventListener("resize", reread);
    // Read once even where we cannot subscribe. A `matchMedia` without
    // `addEventListener` is a real thing — Safari before 14 only had the
    // deprecated `addListener`, and a test stubbing the function at all
    // usually stubs just `matches`. Neither is a reason to throw on a screen
    // whose only question is which layout to draw right now.
    if (typeof list.addEventListener !== "function") return () => window.removeEventListener("resize", reread);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("resize", reread);
      list.removeEventListener("change", onChange);
    };
  }, [query]);

  return matches;
}

/**
 * Phone layout. The cut is Tailwind's `md` (768px), so `useIsPhone()` and the
 * `md:` prefix always agree about which layout is on screen — a screen that
 * disagreed with its own utility classes would render half of each.
 *
 * Only for structural swaps the class system cannot express: a table becoming
 * cards, a side rail becoming a bottom sheet, a split view becoming tabs.
 * Anything that is only a matter of size, spacing or column count belongs in
 * `md:` classes, which cost no JavaScript and never disagree with the viewport.
 */
export function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
