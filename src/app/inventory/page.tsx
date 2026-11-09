import type { Metadata } from "next";
import { Suspense } from "react";
import { InventoryContent } from "@/components/InventoryContent";

// No description / Open Graph tags here: the Lightspeed store manages those on this page.
export const metadata: Metadata = {
  title: "Inventory Hub | Woody's Paper",
  alternates: { canonical: "/inventory" },
};

export default function InventoryPage() {
  // The ?q= search is only known in the browser, so the hub renders client-side.
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <InventoryContent />
    </Suspense>
  );
}
