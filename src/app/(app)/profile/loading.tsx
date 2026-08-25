export default function ProfileLoading() {
  return (
    <main className="px-container-padding py-stack-gap-lg max-w-md mx-auto flex flex-col items-center justify-center min-h-[60vh]">
      <span
        aria-hidden
        className="w-10 h-10 border-4 border-surface-variant border-t-primary rounded-full animate-spin"
      />
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-4">Loading your profile...</p>
    </main>
  );
}
