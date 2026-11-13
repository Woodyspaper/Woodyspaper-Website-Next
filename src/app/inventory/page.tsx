import type { Metadata } from "next";
import { Suspense } from "react";
import { InventoryContent } from "@/components/InventoryContent";

export const metadata: Metadata = {
  title: "All products | Woody's Paper",
  description:
    "Browse Woody's Paper's wholesale catalog: paper, packaging, food service and janitorial supplies, in stock in South Florida. Filter by brand, color and finish.",
  alternates: { canonical: "/inventory" },
};

export default function InventoryPage() {
  // Search, category and filters come from the address, which is only known in the browser.
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <InventoryContent />
    </Suspense>
  );
}
