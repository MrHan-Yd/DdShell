import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface AuroraSegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function AuroraSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: AuroraSegmentedControlProps<T>) {
  return (
    <div className={cn("seg-control", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={cn("seg", value === opt.value && "is-active")}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
