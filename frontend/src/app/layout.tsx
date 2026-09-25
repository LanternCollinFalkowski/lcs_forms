import type { Metadata, Viewport } from "next";
import "@/index.css";

export const metadata: Metadata = {
  title: "Lantern Forms",
  icons: { icon: "/lcs_logo_color.svg" },
  appleWebApp: { capable: true, title: "Forms", statusBarStyle: "default" },
};

/** viewport-fit=cover so env(safe-area-inset-*) is real on notched phones. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbfcfd",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
