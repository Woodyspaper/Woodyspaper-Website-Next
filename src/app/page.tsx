import type { Metadata } from "next";
import { HeroSection } from "@/components/HeroSection";
import { InquirySection } from "@/components/InquirySection";
import { InventoryPreview } from "@/components/InventoryPreview";

const HOME_TITLE = "Woody's Paper | Wholesale Packaging & Tissue Paper South Florida";

export const metadata: Metadata = {
  title: HOME_TITLE,
  description:
    "Meet Woody, South Florida's premier professional wholesale advisor for tissue paper and packaging. Serving South Florida.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: HOME_TITLE,
    description: "Wholesale packaging and paper solutions dispatched daily across South Florida.",
    url: "/",
  },
};

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <InventoryPreview />
      <InquirySection />
    </>
  );
}
