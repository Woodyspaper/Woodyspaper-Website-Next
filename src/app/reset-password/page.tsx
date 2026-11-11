import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/account/AuthForms";

// Title only: see layout.tsx for why description tags aren't set through Next.
export const metadata: Metadata = {
  title: "Reset Password | Woody's Paper",
  robots: { index: false },
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
