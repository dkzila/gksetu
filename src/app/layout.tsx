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

export const metadata: Metadata = {
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
