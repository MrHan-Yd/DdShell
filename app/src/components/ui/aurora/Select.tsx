import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface AuroraSelectOption {
  value: string;
  label: string;
}

export interface AuroraSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: AuroraSelectOption[];
  className?: string;
}

interface PopoverRect {
  top: number;
  left: number;
  width: number;
}

export function AuroraSelect({ value, onChange, options, className }: AuroraSelectProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<PopoverRect | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  const computeRect = useCallback(() => {
    const trigger = wrapperRef.current?.querySelector("button.select") as HTMLButtonElement | null;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (open) {
      computeRect();
    } else {
      setMounted(false);
    }
  }, [open, computeRect]);

  useEffect(() => {
    if (!open || !rect) return;
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [open, rect]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        wrapperRef.current && !wrapperRef.current.contains(t) &&
        popoverRef.current && !popoverRef.current.contains(t)
      ) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScrollOrResize = () => computeRect();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close, computeRect]);

  return (
    <div ref={wrapperRef} className={cn("select-wrapper", className)}>
      <button
        type="button"
        className="select"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{selectedLabel}</span>
      </button>
      {open && rect
        ? createPortal(
            <div
              ref={popoverRef}
              className={cn("popover select-popover", mounted && "is-open")}
              role="listbox"
              style={{
                position: "fixed",
                top: rect.top,
                left: rect.left,
                minWidth: rect.width,
                zIndex: 1000,
              }}
            >
              {options.map((opt) => (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  className={cn("list-item", opt.value === value && "is-active")}
                  onClick={() => {
                    onChange(opt.value);
                    close();
                  }}
                >
                  {opt.label}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
