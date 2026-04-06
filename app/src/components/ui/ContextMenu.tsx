import { useState, useEffect, useRef, useCallback } from "react";

export interface ContextMenuItem {
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuSeparator {
  type: "separator";
}

export type MenuItem = ContextMenuItem | ContextMenuSeparator;

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** Boundary container for edge detection. If omitted, uses viewport. */
  containerRef?: React.RefObject<HTMLElement | null>;
}

export function ContextMenu({ x, y, items, onClose, containerRef }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Adjust position to stay within container bounds
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (containerRef?.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // x, y are already relative to container
      if (adjustedX + menuWidth > rect.width) {
        adjustedX = rect.width - menuWidth;
      }
      if (adjustedY + menuHeight > rect.height) {
        adjustedY = rect.height - menuHeight;
      }
    } else {
      // Use viewport
      if (adjustedX + menuWidth > window.innerWidth) {
        adjustedX = window.innerWidth - menuWidth;
      }
      if (adjustedY + menuHeight > window.innerHeight) {
        adjustedY = window.innerHeight - menuHeight;
      }
    }

    adjustedX = Math.max(0, adjustedX);
    adjustedY = Math.max(0, adjustedY);

    setPos({ x: adjustedX, y: adjustedY });
  }, [x, y, containerRef]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use pointerdown for faster response, delay to avoid the same right-click
    const timer = setTimeout(() => {
      document.addEventListener("pointerdown", handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handler);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Move highlight to hovered item
  const updateHighlight = useCallback((el: HTMLElement | null) => {
    const highlight = menuRef.current?.querySelector<HTMLElement>("[data-menu-highlight]");
    if (!highlight || !el) return;
    highlight.style.top = `${el.offsetTop}px`;
    highlight.style.height = `${el.offsetHeight}px`;
  }, []);

  return (
    <>
      {/* Invisible backdrop to catch clicks */}
      <div className="fixed inset-0 z-40" onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={menuRef}
        className="absolute z-50 min-w-[180px] py-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg shadow-lg animate-context-menu"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sliding highlight */}
        <div
          data-menu-highlight
          className="absolute left-0.5 right-0.5 bg-[var(--color-bg-hover)] rounded transition-all duration-150 ease-spring pointer-events-none"
        />

        {items.map((item, i) => {
          if ("type" in item && item.type === "separator") {
            return <div key={`sep-${i}`} className="my-1 border-t border-[var(--color-border)]" />;
          }

          const menuItem = item as ContextMenuItem;
          return (
            <button
              key={`item-${i}`}
              data-menu-item
              disabled={menuItem.disabled}
              className={[
                "w-full px-3 py-1.5 text-left text-[var(--font-size-sm)] flex items-center gap-2 relative z-10 transition-colors",
                menuItem.disabled
                  ? "opacity-40 cursor-not-allowed"
                  : "cursor-default",
                menuItem.danger && !menuItem.disabled
                  ? "text-[var(--color-error)]"
                  : "text-[var(--color-text-primary)]",
              ].join(" ")}
              onMouseEnter={(e) => updateHighlight(e.currentTarget)}
              onMouseLeave={() => updateHighlight(null)}
              onClick={() => {
                if (menuItem.disabled) return;
                menuItem.onClick?.();
                onClose();
              }}
            >
              {menuItem.icon && (
                <span className={menuItem.danger ? "text-[var(--color-error)]" : "text-[var(--color-text-muted)]"}>
                  {menuItem.icon}
                </span>
              )}
              {menuItem.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * Hook to manage context menu state.
 *
 * Usage:
 * ```tsx
 * const { menuState, onContextMenu } = useContextMenu<MyData>();
 *
 * <div ref={containerRef}>
 *   {items.map(item => (
 *     <div
 *       key={item.id}
 *       onContextMenu={(e) => onContextMenu(e, item)}
 *     />
 *   ))}
 *   {menuState && (
 *     <ContextMenu
 *       x={menuState.x}
 *       y={menuState.y}
 *       onClose={menuState.close}
 *       containerRef={containerRef}
 *       items={buildMenuItems(menuState.data)}
 *     />
 *   )}
 * </div>
 * ```
 */
export function useContextMenu<T = void>() {
  const [state, setState] = useState<{
    x: number;
    y: number;
    data: T;
  } | null>(null);

  const onContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent, data: T) => {
      e.preventDefault();
      e.stopPropagation();

      let x: number;
      let y: number;

      // Use clientX/clientY as base — the ContextMenu component
      // handles viewport/container boundary adjustment.
      x = e.clientX;
      y = e.clientY;

      // If the event target is inside a positioned container,
      // convert to container-relative coordinates
      const container = (e.currentTarget as HTMLElement)?.closest?.("[data-context-menu-container]");
      if (container) {
        const rect = container.getBoundingClientRect();
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
      }

      setState({ x, y, data });
    },
    [],
  );

  const close = useCallback(() => setState(null), []);

  return {
    menuState: state
      ? { x: state.x, y: state.y, data: state.data, close }
      : null,
    onContextMenu,
    closeMenu: close,
  };
}
