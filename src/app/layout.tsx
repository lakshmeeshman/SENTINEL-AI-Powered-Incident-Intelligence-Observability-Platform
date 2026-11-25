import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/shell/providers";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Sentinel — Incident intelligence", template: "%s · Sentinel" },
  description: "See the signal. Stop the incident. Sentinel is an AI-powered incident intelligence and observability platform: live telemetry, anomaly detection, root-cause analysis and postmortems.",
  applicationName: "Sentinel",
  keywords: ["observability", "incident management", "AIOps", "root cause analysis", "SRE", "postmortem", "anomaly detection"],
  authors: [{ name: "Sentinel" }],
  openGraph: {
    title: "Sentinel — See the signal. Stop the incident.",
    description: "AI-powered incident intelligence: live telemetry, anomaly detection, root-cause analysis and one-click postmortems.",
    type: "website",
    siteName: "Sentinel",
  },
  twitter: { card: "summary_large_image", title: "Sentinel — Incident intelligence", description: "See the signal. Stop the incident." },
};

export const viewport: Viewport = {
  themeColor: "#080B12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
