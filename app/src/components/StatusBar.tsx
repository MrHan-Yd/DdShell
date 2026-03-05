export function StatusBar() {
  return (
    <footer className="flex h-[var(--height-statusbar)] items-center border-t border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4">
      <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
        Shell v0.1.0
      </span>
      <span className="ml-auto text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
        Ready
      </span>
    </footer>
  );
}
