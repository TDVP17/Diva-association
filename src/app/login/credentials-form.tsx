"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction, signUpAction, type AuthFormState } from "./actions";

const initialState: AuthFormState = {};

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
    >
      {pending && (
        <span
          aria-hidden
          className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
        />
      )}
      {pending ? "Please wait..." : children}
    </button>
  );
}

export function CredentialsForm({ callbackUrl }: { callbackUrl: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signInFormAction] = useActionState(
    signInAction.bind(null, callbackUrl),
    initialState,
  );
  const [signUpState, signUpFormAction] = useActionState(
    signUpAction.bind(null, callbackUrl),
    initialState,
  );

  return (
    <div className="relative z-10">
      <div className="flex bg-surface-container-low rounded-lg p-1 mb-stack-gap-md">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={
            mode === "signin"
              ? "flex-1 py-1.5 rounded-md font-label-md text-label-md bg-white shadow-sm text-primary font-semibold transition-all"
              : "flex-1 py-1.5 rounded-md font-label-md text-label-md text-on-surface-variant transition-all"
          }
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={
            mode === "signup"
              ? "flex-1 py-1.5 rounded-md font-label-md text-label-md bg-white shadow-sm text-primary font-semibold transition-all"
              : "flex-1 py-1.5 rounded-md font-label-md text-label-md text-on-surface-variant transition-all"
          }
        >
          Sign Up
        </button>
      </div>

      {mode === "signin" ? (
        <form action={signInFormAction} className="space-y-stack-gap-md">
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="signin-email"
              name="email"
              type="email"
              placeholder=" "
              required
            />
            <label className="floating-label" htmlFor="signin-email">
              Email
            </label>
          </div>
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="signin-password"
              name="password"
              type="password"
              placeholder=" "
              required
            />
            <label className="floating-label" htmlFor="signin-password">
              Password
            </label>
          </div>
          {signInState.error && (
            <p className="font-label-sm text-label-sm text-error text-center">{signInState.error}</p>
          )}
          <SubmitButton>Sign In</SubmitButton>
        </form>
      ) : (
        <form action={signUpFormAction} className="space-y-stack-gap-md">
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="signup-name"
              name="fullName"
              type="text"
              placeholder=" "
              required
            />
            <label className="floating-label" htmlFor="signup-name">
              Full Name
            </label>
          </div>
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="signup-email"
              name="email"
              type="email"
              placeholder=" "
              required
            />
            <label className="floating-label" htmlFor="signup-email">
              Email
            </label>
          </div>
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="signup-password"
              name="password"
              type="password"
              placeholder=" "
              required
              minLength={6}
            />
            <label className="floating-label" htmlFor="signup-password">
              Password
            </label>
          </div>
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="signup-sponsor"
              name="sponsorCode"
              type="text"
              placeholder=" "
              required
            />
            <label className="floating-label" htmlFor="signup-sponsor">
              Sponsor/Garant Code
            </label>
          </div>
          {signUpState.error && (
            <p className="font-label-sm text-label-sm text-error text-center">{signUpState.error}</p>
          )}
          {signUpState.success && (
            <p className="font-label-sm text-label-sm text-primary text-center">{signUpState.success}</p>
          )}
          <SubmitButton>Create Account</SubmitButton>
        </form>
      )}
    </div>
  );
}
