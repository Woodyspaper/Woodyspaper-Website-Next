import type { Metadata } from "next";
import { LoginForm } from "@/components/account/AuthForms";

// Title only: see layout.tsx for why description tags aren't set through Next.
export const metadata: Metadata = {
  title: "Sign In | Woody's Paper",
  robots: { index: false },
};

export default function LoginPage() {
  return <LoginForm />;
}
