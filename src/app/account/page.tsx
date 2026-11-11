import type { Metadata } from "next";
import { AccountPanel } from "@/components/account/AccountPanel";

// Title only: see layout.tsx for why description tags aren't set through Next.
export const metadata: Metadata = {
  title: "Your Account | Woody's Paper",
  robots: { index: false },
};

export default function AccountPage() {
  return <AccountPanel />;
}
