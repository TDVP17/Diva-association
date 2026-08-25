"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateProfileAction, type ProfileFormState } from "./actions";

const initialState: ProfileFormState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
    >
      {pending ? "Saving..." : "Save"}
    </button>
  );
}

export function ProfileForm({
  phone,
  city,
  neighborhood,
}: {
  phone: string | null;
  city: string | null;
  neighborhood: string | null;
}) {
  const [state, formAction] = useActionState(updateProfileAction, initialState);

  return (
    <form action={formAction} className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 mb-stack-gap-lg flex flex-col gap-3">
      <div>
        <label htmlFor="phone" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          WhatsApp Number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={phone ?? ""}
          placeholder="237670000000"
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
      </div>
      <div>
        <label htmlFor="city" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          City
        </label>
        <input
          id="city"
          name="city"
          type="text"
          defaultValue={city ?? ""}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
      </div>
      <div>
        <label htmlFor="neighborhood" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          Neighborhood
        </label>
        <input
          id="neighborhood"
          name="neighborhood"
          type="text"
          defaultValue={neighborhood ?? ""}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
      </div>
      {state.error && <p className="font-label-sm text-label-sm text-error">{state.error}</p>}
      {state.success && <p className="font-label-sm text-label-sm text-primary">{state.success}</p>}
      <SaveButton />
    </form>
  );
}
