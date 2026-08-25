"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { changePasswordAction, type ProfileFormState } from "./actions";

const initialState: ProfileFormState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
    >
      {pending ? "Updating..." : "Update Password"}
    </button>
  );
}

function PasswordInput({
  id,
  name,
  label,
}: {
  id: string;
  name: string;
  label: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required
          className="w-full border border-outline-variant rounded-lg px-3 py-2 pr-10 font-label-md text-label-md"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-outline hover:text-primary transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">
            {visible ? "visibility_off" : "visibility"}
          </span>
        </button>
      </div>
    </div>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  return (
    <form
      action={formAction}
      className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex flex-col gap-3"
    >
      <PasswordInput id="currentPassword" name="currentPassword" label="Current Password" />
      <PasswordInput id="newPassword" name="newPassword" label="New Password" />
      <PasswordInput id="confirmPassword" name="confirmPassword" label="Confirm New Password" />
      {state.error && <p className="font-label-sm text-label-sm text-error">{state.error}</p>}
      {state.success && <p className="font-label-sm text-label-sm text-primary">{state.success}</p>}
      <SaveButton />
    </form>
  );
}
