import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)] disabled:pointer-events-none disabled:opacity-45 cursor-default",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-[#0A84FF] to-[#0066E0] text-white rounded-[var(--radius-control)] shadow-[var(--shadow-card)] hover:brightness-106 active:translate-y-px active:shadow-none",
        secondary:
          "bg-[var(--surface-card)] text-[var(--color-text-primary)] rounded-[var(--radius-control)] shadow-[var(--border-hairline-inner),var(--border-hairline-outer)] backdrop-blur-sm hover:bg-[var(--color-bg-hover)]",
        ghost:
          "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] rounded-[var(--radius-control)]",
        danger:
          "bg-[var(--color-error)] text-white hover:opacity-90 rounded-[var(--radius-control)] shadow-[var(--shadow-card)] active:translate-y-px",
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
