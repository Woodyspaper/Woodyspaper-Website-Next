import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { BackgroundDecor } from "@/components/BackgroundDecor";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { UtilityBar } from "@/components/UtilityBar";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["700", "900"],
});

/*
 * Shared metadata only. Description / Open Graph / Twitter tags live on the
 * home page, not here: on /inventory the Lightspeed store rewrites and then
 * deletes those tags, and React crashes on the next navigation if it owns them.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://woodyspaper.com"),
  title: "Woody's Paper",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0070bb",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body>
        <div id="top" className="relative text-slate-800">
          <BackgroundDecor />
          <UtilityBar />
          <Header />
          <main className="relative z-10 pt-chrome lg:pt-chrome-lg">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
