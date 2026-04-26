import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-3xl border border-white/10 bg-surface-raised/60 p-8 text-sm text-slate-300 backdrop-blur-xl">
          Loading…
        </div>
      }
    >
      <LoginForm
        title="Sign in"
        subtitle="Use the email and password you registered with. You will be redirected home after a successful login."
      />
    </Suspense>
  );
}
