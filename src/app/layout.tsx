import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * CONSOLE-S1: the static site metadata, EXTENDED per-request with the
 * site-verification tokens the team manages in Console → Settings →
 * Integrations (SiteSettings registry — no redeploy needed to verify
 * ownership in Google Search Console / Bing Webmaster). The DB read is
 * fail-open: a settings-registry hiccup must never break rendering.
 */
export async function generateMetadata(): Promise<Metadata> {
  let verification: Metadata["verification"] | undefined
  try {
    // Local, direct reads — the layout must not import route handlers.
    const { getPublicSettingValue } = await import("@/modules/site-settings")
    const [google, bing] = await Promise.all([
      getPublicSettingValue("integration.gsc.verificationToken"),
      getPublicSettingValue("integration.bing.verificationToken"),
    ])
    if (google || bing) {
      verification = {
        ...(google ? { google: google } : {}),
        ...(bing ? { other: { 'msvalidate.01': bing } } : {}),
      }
    }
  } catch {
    // Fail-open: metadata without verification beats no metadata.
  }

  return {
    metadataBase: new URL(process.env.GKSETU_PUBLIC_BASE_URL ?? "http://localhost:3000"),
    title: {
      default: "GKSetu — Next-Gen Global GK & Current Affairs Platform",
      template: "%s | GKSetu",
    },
    description:
      "One unified, multilingual, personalised knowledge system for general learners and exam aspirants — replacing GK books, magazines and GK-only coaching.",
    keywords: ["GKSetu", "GK", "General Knowledge", "Current Affairs", "Exam Preparation", "Mock Tests", "Quizzes"],
    applicationName: "GKSetu",
    icons: {
      icon: [{ url: "/icon.png", type: "image/png" }],
      apple: [{ url: "/icon.png" }],
    },
    ...(verification ? { verification } : {}),
    openGraph: {
      title: "GKSetu — Next-Gen Global GK & Current Affairs Platform",
      description: "Personalised, exam-centric GK and current affairs — one canonical knowledge system.",
      siteName: "GKSetu",
      type: "website",
      images: [
        {
          url: "/og.png",
          width: 1216,
          height: 640,
          alt: "GKSetu — GK, current affairs and exam preparation on one canonical knowledge system",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "GKSetu — Next-Gen Global GK & Current Affairs Platform",
      description: "Personalised, exam-centric GK and current affairs — one canonical knowledge system.",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
