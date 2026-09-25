"use client";

import dynamic from "next/dynamic";

// The SPA is client-only (react-router owns the URL; auth/theme read the
// browser). Disable SSR so nothing renders on the server.
const AppClient = dynamic(() => import("@/AppClient"), {
  ssr: false,
  loading: () => <div style={{ height: "100vh" }} />,
});

export default function CatchAllPage() {
  return <AppClient />;
}
