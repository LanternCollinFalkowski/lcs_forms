"use client";

/**
 * Route-level fallback for the App Router segment that hosts the SPA.
 *
 * The in-app ErrorBoundary catches almost everything, because the whole SPA
 * renders beneath it. This is the layer under that: a failure while the client
 * bundle is mounting, before any of our own providers exist. Without it the
 * person gets a blank document.
 *
 * `retry` (not `reset`) is this Next version's prop name — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "70vh", padding: "2rem" }}>
      <div style={{ maxWidth: "28rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>Lantern Forms didn&apos;t load</h1>
        <p style={{ marginTop: ".5rem", fontSize: ".875rem", opacity: 0.7 }}>
          Something went wrong starting the app. Nothing has been changed.
        </p>
        {error.digest ? (
          <p style={{ marginTop: ".75rem", fontFamily: "monospace", fontSize: ".75rem", opacity: 0.6 }}>
            Reference {error.digest}
          </p>
        ) : null}
        <button
          onClick={() => retry()}
          style={{ marginTop: "1.25rem", height: "2.25rem", padding: "0 1rem", borderRadius: 6, border: 0, background: "#2c3453", color: "#fff", fontWeight: 600, cursor: "pointer" }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
