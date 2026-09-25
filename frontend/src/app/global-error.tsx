"use client";

/**
 * Last resort: a failure in the root layout itself, which error.tsx sits inside
 * and therefore cannot catch.
 *
 * This file replaces the root layout when it renders, so it has to supply its
 * own <html> and <body> — and it gets none of the app's global CSS, so the
 * styles here are inline and deliberately plain. It follows the OS colour
 * scheme rather than the in-app theme, which isn't reachable from here.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#e9edf2",
          color: "#232a3a",
        }}
      >
        <title>Lantern Forms</title>
        <div style={{ maxWidth: "28rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>Lantern Forms is unavailable</h1>
          <p style={{ marginTop: ".5rem", fontSize: ".875rem", color: "#6a7189" }}>
            The app failed to start. Try again, and if it keeps happening contact the IT Team at
            helpdesk@progressny.com.
          </p>
          {error.digest ? (
            <p style={{ marginTop: ".75rem", fontFamily: "monospace", fontSize: ".75rem", color: "#6a7189" }}>
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
      </body>
    </html>
  );
}
