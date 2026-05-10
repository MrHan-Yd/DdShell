import { forwardRef, type ButtonHTMLAttributes } from "react";
import { useAppStore } from "@/stores/app";
import { Button as ClassicButton, type ButtonProps as ClassicButtonProps } from "@/components/ui/Button";
import {
  AuroraButton,
  type AuroraButtonSize,
  type AuroraButtonVariant,
} from "@/components/ui/aurora/Button";

type Variant = NonNullable<ClassicButtonProps["variant"]>;
type Size = NonNullable<ClassicButtonProps["size"]>;

const variantToAurora: Record<Variant, AuroraButtonVariant> = {
  default: "primary",
  secondary: "secondary",
  ghost: "ghost",
  danger: "danger",
};

const sizeToAurora: Record<Size, AuroraButtonSize> = {
  sm: "sm",
  md: "md",
  lg: "lg",
  icon: "icon",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, ...rest }, ref) => {
    const isAurora = useAppStore((s) => s.uiTheme === "aurora");
    if (isAurora) {
      return (
        <AuroraButton
          ref={ref}
          variant={variant ? variantToAurora[variant] : "primary"}
          size={size ? sizeToAurora[size] : "md"}
          {...rest}
        />
      );
    }
    return <ClassicButton ref={ref} variant={variant} size={size} {...rest} />;
  },
);
Button.displayName = "Button";
