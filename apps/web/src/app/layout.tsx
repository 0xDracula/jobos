import type { Metadata, Viewport } from "next";
import { Aref_Ruqaa, Caveat, Manrope, Readex_Pro } from "next/font/google";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell";

import "./globals.css";
import { Providers } from "./providers";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const readex = Readex_Pro({ subsets: ["arabic"], variable: "--font-readex", display: "swap", preload: false });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap", preload: false });
const ruqaa = Aref_Ruqaa({ subsets: ["arabic"], weight: ["400", "700"], variable: "--font-ruqaa", display: "swap", preload: false });

const SPLASH: [number, number, number][] = [
  [375, 667, 2],
  [414, 896, 2],
  [375, 812, 3],
  [414, 896, 3],
  [390, 844, 3],
  [393, 852, 3],
  [402, 874, 3],
  [420, 912, 3],
  [428, 926, 3],
  [430, 932, 3],
  [440, 956, 3],
];

export const metadata: Metadata = {
  title: "Jobbos",
  description: "Private music player",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Jobbos",
    statusBarStyle: "default",
    startupImage: SPLASH.map(([w, h, r]) => ({
      url: `/icons/splash-${w * r}x${h * r}.png`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
    })),
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1014" },
  ],
};

const prefsScript = `try{var p=JSON.parse(localStorage.getItem("jobbos.prefs")||"{}").state||{};var r=document.documentElement;if(p.theme==="day"||p.theme==="night")r.dataset.theme=p.theme;if(p.motion==="reduced")r.dataset.motion="reduced"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={[manrope, readex, caveat, ruqaa].map((f) => f.variable).join(" ")}
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
