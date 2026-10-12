import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/src/context/AuthContext";
import { HtmlLang } from "@/src/i18n/LanguageSwitch";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MIRRA AI — Ryde Dispute Resolution",
  description: "MIRRA AI hackathon showcase: multi-agent dispute resolution for Ryde.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-white text-[#111827]">
        <HtmlLang />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
