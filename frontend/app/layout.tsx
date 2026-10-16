import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Noto_Nastaliq_Urdu } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const sans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });
const urdu = Noto_Nastaliq_Urdu({ variable: "--font-urdu", subsets: ["arabic"], weight: ["400", "600"] });

export const metadata: Metadata = {
  title: "Awaaz",
  description: "Get help fast, or report harassment safely.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f2ed" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1012" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${urdu.variable}`}>
      <body className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
        <Nav />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
