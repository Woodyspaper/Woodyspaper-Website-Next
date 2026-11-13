import type { Metadata } from "next";
import { Suspense } from "react";
import { StoreCheckout } from "@/components/StoreCheckout";

// Title only: the Lightspeed checkout drawn on this page rewrites and deletes
// other meta tags, and React crashes on the next navigation if it owns them.
// robots.ts keeps search engines out of /checkout.
export const metadata: Metadata = {
  title: "Checkout | Woody's Paper",
};

export default function CheckoutPage() {
  // ?account=1 is only known in the browser, so the page renders client-side.
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <StoreCheckout />
    </Suspense>
  );
}
