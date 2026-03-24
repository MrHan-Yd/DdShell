import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { Command, Globe, User, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import * as api from "@/lib/tauri";
import type { CandidateItem } from "@/lib/tauri";
import { useT } from "@/lib/i18n";

export type AssistPosition = "bottom-left" | "bottom-right" | "follow-cursor";

interface CommandAssistProps {
  visible: boolean;
  query: string;
  osType: string | null;
  position: AssistPosition;
  /** Cursor grid coordinates + cell dimensions (container-relative) */
  cursorCol: number;
  cursorRow: number;
  charW: number;
  charH: number;
  /** Offset of xterm-rows within the container */
  offsetX: number;
  offsetY: number;
  /** Container dimensions for boundary clamping */
  containerWidth: number;
  containerHeight: number;
  confirmKey: "tab" | "enter";
  onSelect: (command: string, id: string) => void;
  onClose: () => void;
}

const POPUP_WIDTH = 420;
const POPUP_MAX_HEIGHT = 320;
const EDGE_MARGIN = 8;

export function CommandAssist({
  visible,
  query,
  osType,
  position,
  cursorCol,
  cursorRow,
  charW,
  charH,
  offsetX,
  offsetY,
  containerWidth,
  containerHeight,
  confirmKey,
  onSelect,
  onClose,
}: CommandAssistProps) {
  const t = useT();
  const [items, setItems] = useState<CandidateItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [computedStyle, setComputedStyle] = useState<React.CSSProperties>({});

  // Search when query changes
  useEffect(() => {
    if (!visible || !query) {
      setItems([]);
      setTotal(0);
      setHasMore(false);
      setPage(0);
      setSelectedIndex(0);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.commandAssistSearch(query, osType, 0);
        setItems(result.items);
        setTotal(result.total);
        setHasMore(result.hasMore);
        setPage(0);
        setSelectedIndex(0);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 80);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, osType, visible]);

  // Load more pages
  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    const nextPage = page + 1;
    setLoading(true);
    try {
      const result = await api.commandAssistSearch(query, osType, nextPage);
      setItems((prev) => [...prev, ...result.items]);
      setHasMore(result.hasMore);
      setPage(nextPage);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, page, query, osType]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!visible || items.length === 0) return false;

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
        return true;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = prev >= items.length - 1 ? 0 : prev + 1;
          if (next >= items.length * 0.7 && hasMore) loadMore();
          return next;
        });
        return true;
      }
      if (
        (confirmKey === "tab" && e.key === "Tab") ||
        (confirmKey === "enter" && e.key === "Enter")
      ) {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) onSelect(item.command, item.id);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return true;
      }
      return false;
    },
    [visible, items, selectedIndex, confirmKey, hasMore, loadMore, onSelect, onClose],
  );

  const keyHandlerRef = useRef(handleKeyDown);
  keyHandlerRef.current = handleKeyDown;

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement;
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Global keyboard listener
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => { keyHandlerRef.current(e); };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [visible]);

  // ── Position calculation (all coordinates relative to container) ──
  // Run after every render so popupRef.current?.offsetHeight is accurate.
  useLayoutEffect(() => {
    if (!visible || items.length === 0 || !popupRef.current) return;

    const popupH = popupRef.current.offsetHeight;
    const popupW = POPUP_WIDTH;
    const cw = containerWidth;
    const ch = containerHeight;

    let style: React.CSSProperties;

    if (position === "follow-cursor") {
      const cursorX = offsetX + cursorCol * charW;
      const cursorY = offsetY + cursorRow * charH;
      const cursorBottom = cursorY + charH;

      const spaceBelow = ch - cursorBottom - EDGE_MARGIN;

      let top: number;
      if (spaceBelow >= popupH) {
        // Room below: place just under cursor line
        top = cursorBottom + 2;
      } else {
        // Not enough below: place just above cursor line, as close as possible
        top = cursorY - popupH - 2;
        if (top < EDGE_MARGIN) top = EDGE_MARGIN;
      }

      // Horizontal: start from left edge of container, offset by cursor position
      let left = cursorX + charW * 2;
      if (left + popupW > cw - EDGE_MARGIN) left = cw - EDGE_MARGIN - popupW;
      if (left < EDGE_MARGIN) left = EDGE_MARGIN;

      style = { left, top };
    } else if (position === "bottom-right") {
      let right = EDGE_MARGIN;
      const bottom = EDGE_MARGIN;
      if (right + popupW > cw - EDGE_MARGIN) right = cw - EDGE_MARGIN - popupW;
      style = { right, bottom };
    } else {
      // bottom-left
      let left = EDGE_MARGIN;
      const bottom = EDGE_MARGIN;
      if (left + popupW > cw - EDGE_MARGIN) left = cw - EDGE_MARGIN - popupW;
      style = { left, bottom };
    }

    setComputedStyle((prev) => {
      const prevStr = JSON.stringify(prev);
      const nextStr = JSON.stringify(style);
      return prevStr === nextStr ? prev : style;
    });
  }, [visible, items.length, position, cursorCol, cursorRow, charW, charH, offsetX, offsetY, containerWidth, containerHeight]);

  if (!visible || items.length === 0) return null;

  return (
    <div
      ref={popupRef}
      className="absolute z-50 overflow-hidden rounded-[14px] border border-[var(--color-border)] shadow-lg"
      style={{
        width: POPUP_WIDTH,
        maxHeight: POPUP_MAX_HEIGHT,
        ...computedStyle,
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        background: "var(--color-bg-surface-translucent, rgba(15, 17, 21, 0.85))",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <Command size={12} className="text-[var(--color-text-muted)]" />
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {total} {t("commandAssist.matches")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[9px] text-[var(--color-text-muted)]">
            <ChevronUp size={8} className="inline" />
            <ChevronDown size={8} className="inline" />
          </kbd>
          <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[9px] text-[var(--color-text-muted)]">
            {confirmKey === "tab" ? "Tab" : "Enter"}
          </kbd>
          <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[9px] text-[var(--color-text-muted)]">
            Esc
          </kbd>
        </div>
      </div>

      {/* Candidate list */}
      <div ref={listRef} className="max-h-[280px] overflow-y-auto py-1">
        {items.map((item, index) => (
          <div
            key={`${item.id}-${index}`}
            className={cn(
              "flex cursor-pointer items-start gap-2 px-3 py-1.5 transition-colors duration-[120ms] ease-out",
              index === selectedIndex
                ? "bg-[var(--color-accent-subtle)]"
                : "hover:bg-[var(--color-bg-hover)]",
            )}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => onSelect(item.command, item.id)}
          >
            <div className="mt-0.5 flex-shrink-0">
              {item.source === "user" ? (
                <User size={12} className="text-[var(--color-accent)]" />
              ) : (
                <Globe size={12} className="text-[var(--color-text-muted)]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <code className="truncate text-[var(--font-size-xs)] font-mono text-[var(--color-text-primary)]">
                  {item.command}
                </code>
              </div>
              {item.description && (
                <p className="mt-0.5 truncate text-[10px] text-[var(--color-text-muted)]">
                  {item.description}
                </p>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-1 mt-0.5">
              {item.source === "user" && (
                <span className="rounded-full border border-[var(--color-accent)] px-1.5 py-0 text-[9px] text-[var(--color-accent)]">
                  {t("commandAssist.user")}
                </span>
              )}
              {item.distro && item.distro !== "common" && (
                <span className="rounded-full border border-[var(--color-border)] px-1.5 py-0 text-[9px] text-[var(--color-text-muted)]">
                  {item.distro}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="border-t border-[var(--color-border)] px-3 py-1 text-center text-[9px] text-[var(--color-text-muted)]">
          {t("commandAssist.scrollMore")}
        </div>
      )}
    </div>
  );
}
