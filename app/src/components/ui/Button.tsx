import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:pointer-events-none disabled:opacity-50 cursor-default",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] rounded-[var(--radius-control)]",
        secondary:
          "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] rounded-[var(--radius-control)]",
        ghost:
          "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] rounded-[var(--radius-control)]",
        danger:
          "bg-[var(--color-error)] text-white hover:opacity-90 rounded-[var(--radius-control)]",
      },
      size: {
        sm: "h-7 px-2.5 text-[var(--font-size-xs)]",
        md: "h-8 px-3 text-[var(--font-size-sm)]",
        lg: "h-9 px-4 text-[var(--font-size-base)]",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  ),
);
Button.displayName = "Button";
