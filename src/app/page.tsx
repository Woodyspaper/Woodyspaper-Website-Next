import type { Metadata } from "next";
import { HeroSection } from "@/components/HeroSection";
import { BrandCarousel } from "@/components/BrandCarousel";
import { HomeSteps } from "@/components/HomeSteps";
import { InquirySection } from "@/components/InquirySection";

/*
 * Description / Open Graph / Twitter tags are NOT set here. The Lightspeed
 * store on /inventory rewrites and deletes those tags, and React crashes on
 * the next navigation if it owns them. scripts/add-home-meta.mjs writes them into
 * the built index.html instead, where search engines and link previews read them.
 */
export const metadata: Metadata = {
  title: "Woody's Paper | Wholesale Packaging & Tissue Paper South Florida",
  alternates: { canonical: "/" },
};

/*
 * The home page exists to get visitors into the store: what we sell and a
 * button to it (hero), a carousel of the brands we stock, how ordering and
 * account pricing work, then a small quote form for those who'd rather ask.
 */
export default function HomePage() {
  return (
    <>
      <HeroSection />
      <BrandCarousel />
      <HomeSteps />
      <InquirySection />
    </>
  );
}
