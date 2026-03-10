import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
}

export function Select({ value, onChange, options, className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  const close = useCallback(() => setOpen(false), []);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  // close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-[var(--font-size-sm)] text-[var(--color-text-primary)] transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)] cursor-default",
          "hover:border-[var(--color-text-muted)]",
          open
            ? "border-[var(--color-border-focus)] ring-2 ring-[var(--color-border-focus)]/30 shadow-[inset_0_0_0_1px_var(--color-border-focus)]"
            : "focus:border-[var(--color-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-border-focus)]/30 focus:shadow-[inset_0_0_0_1px_var(--color-border-focus)]",
        )}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          size={14}
          className={cn(
            "ml-2 shrink-0 text-[var(--color-text-muted)] transition-transform duration-[var(--duration-base)] ease-[var(--ease-smooth)]",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      <div
        className={cn(
          "absolute left-0 right-0 z-50 mt-1 rounded-[var(--radius-popover)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-floating)] transition-all duration-150 ease-[var(--ease-smooth)] origin-top",
          open
            ? "opacity-100 translate-y-0 scale-100 pointer-events-auto"
            : "opacity-0 -translate-y-1 scale-[0.98] pointer-events-none",
        )}
      >
        <div className="p-1">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                close();
              }}
              className={cn(
                "flex w-full items-center rounded-[var(--radius-control)] px-3 py-1.5 text-left text-[var(--font-size-sm)] transition-colors duration-100",
                opt.value === value
                  ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
