import { forwardRef } from "react";
import { useAppStore } from "@/stores/app";
import { Input as ClassicInput, type InputProps } from "@/components/ui/Input";
import { AuroraInput } from "@/components/ui/aurora/Input";

export type { InputProps };

export const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  const isAurora = useAppStore((s) => s.uiTheme === "aurora");
  return isAurora ? (
    <AuroraInput ref={ref} {...props} />
  ) : (
    <ClassicInput ref={ref} {...props} />
  );
});
Input.displayName = "Input";
