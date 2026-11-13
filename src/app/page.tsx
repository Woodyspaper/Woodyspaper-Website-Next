import type { Metadata } from "next";
import { HeroSection } from "@/components/HeroSection";
import { AboutSection } from "@/components/AboutSection";
import { BrandCarousel } from "@/components/BrandCarousel";
import { HomeSteps } from "@/components/HomeSteps";
import { InquirySection } from "@/components/InquirySection";

/*
 * Description / Open Graph / Twitter tags are NOT set here. Lightspeed's
 * checkout (/checkout) rewrites and deletes those tags, and React crashes on
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
 * account pricing work, a small quote form for those who'd rather ask, and
 * last, who we are and what we sell in words (for visitors and search
 * engines): reading matter, so it sits below everything there is to do.
 */
export default function HomePage() {
  return (
    <>
      <HeroSection />
      <BrandCarousel />
      <HomeSteps />
      <InquirySection />
      <AboutSection />
    </>
  );
}
