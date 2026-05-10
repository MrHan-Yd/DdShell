import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface AuroraInputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const AuroraInput = forwardRef<HTMLInputElement, AuroraInputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      className={cn("input", className)}
      data-error={error ? "true" : undefined}
      {...props}
    />
  ),
);
AuroraInput.displayName = "AuroraInput";
