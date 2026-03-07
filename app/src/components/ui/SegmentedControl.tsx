import { useRef, useEffect, useState, type ReactNode } from "react";

interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

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
    <div ref={containerRef} className={`segmented-control ${className ?? ""}`}>
      <div
        className="seg-pill"
        style={{ left: pillStyle.left, width: pillStyle.width }}
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          data-active={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
