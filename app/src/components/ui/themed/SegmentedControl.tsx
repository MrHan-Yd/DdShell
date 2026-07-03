import { type ReactNode } from "react";
import { useAppStore, usesDesignSystemTheme } from "@/stores/app";
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
  const useDesignSystem = useAppStore((s) => usesDesignSystemTheme(s.uiTheme));
  return useDesignSystem ? (
    <AuroraSegmentedControl {...props} />
  ) : (
    <ClassicSegmentedControl {...props} />
  );
}
