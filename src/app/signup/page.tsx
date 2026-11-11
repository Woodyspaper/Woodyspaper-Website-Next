import type { Metadata } from "next";
import { SignupForm } from "@/components/account/AuthForms";

// Title only: see layout.tsx for why description tags aren't set through Next.
export const metadata: Metadata = {
  title: "Create Account | Woody's Paper",
  robots: { index: false },
};

export default function SignupPage() {
  return <SignupForm />;
}
