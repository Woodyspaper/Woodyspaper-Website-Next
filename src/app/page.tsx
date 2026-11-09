import type { Metadata } from "next";
import { Suspense } from "react";
import { HeroSection } from "@/components/HeroSection";
import { InquirySection } from "@/components/InquirySection";
import { InventoryContent } from "@/components/InventoryContent";

/*
 * Description / Open Graph / Twitter tags are NOT set here. The Lightspeed
 * store on this page rewrites and deletes those tags, and React crashes on the
 * next navigation if it owns them. scripts/add-home-meta.mjs writes them into
 * the built index.html instead, where search engines and link previews read them.
 */
export const metadata: Metadata = {
  title: "Woody's Paper | Wholesale Packaging & Tissue Paper South Florida",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <HeroSection />
      {/* The store's front page; clicking or searching in it opens /inventory. */}
      <Suspense fallback={<div className="min-h-screen" />}>
        <InventoryContent hubPath="/inventory" />
      </Suspense>
      <InquirySection />
    </>
  );
}
