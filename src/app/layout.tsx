import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/i18n/LanguageContext";
import Navbar from "@/components/Navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSansDevanagari = Noto_Sans_Devanagari({
  variable: "--font-noto-devanagari",
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
<<<<<<< HEAD
  title: "Nagrik | Civic Issue Tracker",
  description: "Geo-tagged civic issue reporting and resolution tracker for India",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
=======
  title: "Civic Issue Tracker | India",
  description: "Geo-tagged civic issue reporting and resolution tracker for India",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
>>>>>>> 5716e2b (Add multilingual and voice features)
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansDevanagari.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <LanguageProvider>
          <Navbar />
          <div className="flex-1 flex flex-col">{children}</div>
        </LanguageProvider>
      </body>
    </html>
  );
}
