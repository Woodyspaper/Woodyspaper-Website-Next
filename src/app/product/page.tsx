import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductView } from "@/components/ProductView";

export const metadata: Metadata = {
  title: "Product | Woody's Paper",
  // One page serves every product (?id=…), so there is no single address to index.
  robots: { index: false, follow: true },
};

export default function ProductPage() {
  // The product id is only known in the browser, so the page renders client-side.
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ProductView />
    </Suspense>
  );
}
