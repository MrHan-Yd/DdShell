export function SettingsPage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <p className="text-[var(--font-size-lg)] font-medium text-[var(--color-text-secondary)]">
          Settings
        </p>
        <p className="mt-2 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
          Configure theme, shortcuts, and preferences.
        </p>
      </div>
    </div>
  );
}
