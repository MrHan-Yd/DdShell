import { forwardRef } from "react";
import { useAppStore, usesDesignSystemTheme } from "@/stores/app";
import { Input as ClassicInput, type InputProps } from "@/components/ui/Input";
import { AuroraInput } from "@/components/ui/aurora/Input";

export type { InputProps };

export const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  const useDesignSystem = useAppStore((s) => usesDesignSystemTheme(s.uiTheme));
  return useDesignSystem ? (
    <AuroraInput ref={ref} {...props} />
  ) : (
    <ClassicInput ref={ref} {...props} />
  );
});
Input.displayName = "Input";
