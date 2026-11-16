import type { Metadata, Viewport } from "next";
import { Aref_Ruqaa, Baloo_Bhaijaan_2, Caveat, Fredoka, Nunito, Tajawal } from "next/font/google";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell";

import "./globals.css";
import { Providers } from "./providers";

const fredoka = Fredoka({ subsets: ["latin"], variable: "--font-fredoka", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", display: "swap" });
const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-tajawal",
  display: "swap",
  preload: false,
});
const baloo = Baloo_Bhaijaan_2({ subsets: ["arabic"], variable: "--font-baloo", display: "swap", preload: false });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap", preload: false });
const ruqaa = Aref_Ruqaa({ subsets: ["arabic"], weight: ["400", "700"], variable: "--font-ruqaa", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "Jobbos",
  description: "Private music player",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Jobbos", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff7f0" },
    { media: "(prefers-color-scheme: dark)", color: "#1e1b3a" },
  ],
};

const prefsScript = `try{var p=JSON.parse(localStorage.getItem("jobbos.prefs")||"{}").state||{};var r=document.documentElement;if(p.theme==="day"||p.theme==="night")r.dataset.theme=p.theme;if(p.motion==="reduced")r.dataset.motion="reduced"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={[fredoka, nunito, tajawal, baloo, caveat, ruqaa].map((f) => f.variable).join(" ")}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: prefsScript }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
