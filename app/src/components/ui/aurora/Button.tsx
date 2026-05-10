import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export type AuroraButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type AuroraButtonSize = "sm" | "md" | "lg" | "icon";

const variantClass: Record<AuroraButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

const sizeClass: Record<AuroraButtonSize, string> = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
  icon: "btn-icon",
};

export interface AuroraButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AuroraButtonVariant;
  size?: AuroraButtonSize;
}

export const AuroraButton = forwardRef<HTMLButtonElement, AuroraButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn("btn", variantClass[variant], sizeClass[size], className)}
      {...props}
    />
  ),
);
AuroraButton.displayName = "AuroraButton";
