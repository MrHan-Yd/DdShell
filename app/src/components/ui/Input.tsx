import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      className={cn(
        "h-8 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-[var(--font-size-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors duration-[var(--duration-fast)] focus:border-[var(--color-border-focus)] focus:outline-none",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
