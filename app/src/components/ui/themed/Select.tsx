import { useAppStore } from "@/stores/app";
import { Select as ClassicSelect, type SelectProps, type SelectOption } from "@/components/ui/Select";
import { AuroraSelect } from "@/components/ui/aurora/Select";

export type { SelectProps, SelectOption };

export function Select(props: SelectProps) {
  const isAurora = useAppStore((s) => s.uiTheme === "aurora");
  return isAurora ? <AuroraSelect {...props} /> : <ClassicSelect {...props} />;
}
