import { type ReactNode } from "react";
import { useAppStore } from "@/stores/app";
import { SegmentedControl as ClassicSegmentedControl } from "@/components/ui/SegmentedControl";
import { AuroraSegmentedControl } from "@/components/ui/aurora/SegmentedControl";

interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>(
  props: SegmentedControlProps<T>,
) {
  const isAurora = useAppStore((s) => s.uiTheme === "aurora");
  return isAurora ? (
    <AuroraSegmentedControl {...props} />
  ) : (
    <ClassicSegmentedControl {...props} />
  );
}
