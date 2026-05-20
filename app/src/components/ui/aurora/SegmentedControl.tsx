import { useRef, useEffect, useState, type ReactNode } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const btn = container.children[idx + 1] as HTMLElement; // +1 to skip pill div
    if (!btn) return;
    setPillStyle({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [value, options]);

  return (
    <div ref={containerRef} className={cn("seg-control", className)}>
      <div
        className="seg-pill"
        style={{ left: pillStyle.left, width: pillStyle.width }}
      />
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
