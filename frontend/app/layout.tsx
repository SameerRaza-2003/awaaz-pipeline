import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Newsreader } from "next/font/google";
import "./globals.css";
import { Discreet } from "@/components/Discreet";
import { Nav } from "@/components/Nav";

// Self-hosted by next/font: no request to Google from the survivor's phone. Only the body face is preloaded.
const atkinson = Atkinson_Hyperlegible_Next({ variable: "--font-atkinson", subsets: ["latin"], display: "swap", preload: true });
const atkinsonMono = Atkinson_Hyperlegible_Mono({ variable: "--font-atkinson-mono", subsets: ["latin"], display: "swap", preload: false });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], display: "swap", preload: false, weight: ["500", "600"] });

export const metadata: Metadata = {
  title: "Awaaz",
  description: "Get help fast, or report harassment safely.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#131110" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${atkinson.variable} ${atkinsonMono.variable} ${newsreader.variable}`}>
      <body className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Discreet />
        <Nav />
        <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          {children}
        </main>
      </body>
    </html>
  );
}
