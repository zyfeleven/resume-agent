import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const description = "A human-supervised workspace for resume tailoring and application review.";

  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: "Resume Agent | Supervised applications",
    description,
    openGraph: {
      title: "Resume Agent",
      description,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Resume Agent dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Resume Agent",
      description,
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
