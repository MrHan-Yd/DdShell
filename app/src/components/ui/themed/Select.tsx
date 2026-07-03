import { useAppStore, usesDesignSystemTheme } from "@/stores/app";
import { Select as ClassicSelect, type SelectProps, type SelectOption } from "@/components/ui/Select";
import { AuroraSelect } from "@/components/ui/aurora/Select";

export type { SelectProps, SelectOption };

export function Select(props: SelectProps) {
  const useDesignSystem = useAppStore((s) => usesDesignSystemTheme(s.uiTheme));
  return useDesignSystem ? <AuroraSelect {...props} /> : <ClassicSelect {...props} />;
}
