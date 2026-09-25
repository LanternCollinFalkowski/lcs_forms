"use client";

import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * The error boundary, keyed on the current route.
 *
 * A class boundary latches its error until something tells it to let go. Keying
 * it on the path means navigating away from a screen that blew up clears the
 * failure, instead of leaving the person stuck on the error page while the URL
 * moves on beneath them.
 */
export function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}
