import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      className={cn(
        "h-8 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-[var(--font-size-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)]",
        "focus:border-[var(--color-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-border-focus)]/30 focus:shadow-[inset_0_0_0_1px_var(--color-border-focus)]",
        error &&
          "border-[var(--color-error)] focus:border-[var(--color-error)] focus:ring-[var(--color-error)]/30 focus:shadow-[inset_0_0_0_1px_var(--color-error)]",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
