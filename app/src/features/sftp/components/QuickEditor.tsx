import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { css } from "@codemirror/legacy-modes/mode/css";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { javascript } from "@codemirror/legacy-modes/mode/javascript";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { python } from "@codemirror/legacy-modes/mode/python";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import {
  closeSearchPanel,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
} from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  getDialog,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { readClipboardText, writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export type QuickEditorLineEnding = "LF" | "CRLF" | "mixed" | "unknown";
export type QuickEditorIndentStyle = "tab" | "spaces-2" | "spaces-4" | "unknown";

export type QuickEditorStatus = {
  line: number;
  column: number;
  lineEnding: QuickEditorLineEnding;
  indentStyle: QuickEditorIndentStyle;
  language: string;
};

export type QuickEditorContextMenuLabels = {
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
};

export type QuickEditorProps = {
  value: string;
  baselineValue?: string;
  remotePath: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  findRequestToken?: number;
  gotoLineRequestToken?: number;
  phrases?: Record<string, string>;
  contextMenuLabels: QuickEditorContextMenuLabels;
  className?: string;
  onChange: (nextValue: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveRequest?: () => void;
  onFindRequest?: () => void;
  onStatusChange?: (status: QuickEditorStatus) => void;
};

export type QuickEditorHandle = {
  focus: () => void;
  openSearch: () => void;
  openReplace: () => void;
  openGotoLine: () => void;
  toggleSearch: () => void;
  toggleSearchReplace: () => void;
  toggleGotoLine: () => void;
};

const cssLanguage = StreamLanguage.define(css);
const dockerfileLanguage = StreamLanguage.define(dockerFile);
const envLanguage = StreamLanguage.define(properties);
const javascriptLanguage = StreamLanguage.define(javascript);
const nginxLanguage = StreamLanguage.define(nginx);
const pythonLanguage = StreamLanguage.define(python);
const rustLanguage = StreamLanguage.define(rust);
const shellLanguage = StreamLanguage.define(shell);
const sqlLanguage = StreamLanguage.define(standardSQL);
const tomlLanguage = StreamLanguage.define(toml);
const xmlLanguage = StreamLanguage.define(xml);

const languageCompartment = new Compartment();
const editableCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const phrasesCompartment = new Compartment();

function closeAnyDialog(view: EditorView) {
  const dlg = getDialog(view, "cm-dialog");
  dlg?.dom.querySelector<HTMLButtonElement>(".cm-dialog-close")?.click();
}

/**
 * 把 data-search-mode 写到 CodeMirror search panel 的 DOM 上，配合 theme 中
 * 的 CSS 在 `find` 模式下隐藏 replace 输入框/按钮，做到"查找只查找，替换才有替换"。
 */
function applySearchModeToActivePanel(view: EditorView, mode: "find" | "replace") {
  const panel = view.dom.querySelector<HTMLElement>(".cm-panel.cm-search");
  if (panel) panel.dataset.searchMode = mode;
}

function focusSearchPanelMainInput(view: EditorView) {
  const input =
    view.dom.querySelector<HTMLInputElement>(".cm-search input[main-field]") ??
    view.dom.querySelector<HTMLInputElement>(".cm-search input[name='search']");
  input?.focus();
  input?.select();
}

function focusSearchPanelReplaceInput(view: EditorView) {
  const input = view.dom.querySelector<HTMLInputElement>(".cm-search input[name='replace']");
  input?.focus();
  input?.select();
}

const quickEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--color-text-primary)",
    background: "transparent",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: '"SF Mono", "JetBrains Mono", Menlo, monospace',
    lineHeight: "1.65",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "14px 0 24px",
    caretColor: "var(--color-accent)",
  },
  ".cm-line": {
    padding: "0 18px 0 10px",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-accent)",
    borderLeftWidth: "1.5px",
  },
  ".cm-selectionBackground": {
    backgroundColor: "#264f78",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "#264f78",
  },
  ".cm-gutters": {
    border: "none",
    background: "transparent",
    color: "var(--color-text-muted)",
    paddingRight: "8px",
  },
  ".cm-gutterElement": {
    padding: "0 10px 0 14px",
    minWidth: "32px",
  },
  ".cm-activeLineGutter": {
    background: "transparent",
    color: "var(--color-text-secondary)",
  },
  ".cm-panels": {
    overflow: "clip",
    background: "rgba(18, 21, 30, 0.88)",
    backdropFilter: "blur(14px) saturate(140%)",
    color: "var(--color-text-primary)",
    borderBottom: "1px solid var(--color-border-subtle)",
  },
  ".cm-panel": {
    animation: "quick-editor-panel-in var(--duration-panel) var(--ease-spring) forwards",
  },
  ".cm-panel.cm-panel-closing": {
    animation: "quick-editor-panel-out calc(var(--duration-panel) * 0.8) var(--ease-smooth) forwards",
  },
  ".cm-panels-top": {
    // borderTop 用 --color-border（跟 search 面板里 input/button 的边框同源），
    // 让 dialog 上方那条线跟 search 内部边框颜色一致；之前用 --color-border-subtle
    // 偏白，跟整体玻璃风格不搭。
    // borderBottom 维持 --color-border-subtle，跟 search 面板/dialog 下方与下方
    // 编辑区的过渡视觉保持原状。
    borderTop: "1px solid var(--color-border)",
    borderBottom: "1px solid var(--color-border-subtle)",
  },
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    padding: "12px",
    alignItems: "center",
  },
  ".cm-search input": {
    minWidth: "140px",
    borderRadius: "var(--radius-control)",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-elevated)",
    color: "var(--color-text-primary)",
    padding: "7px 10px",
    font: "inherit",
    boxShadow: "inset 0 0.5px 0 rgba(255, 255, 255, 0.05)",
  },
  ".cm-search input:focus": {
    outline: "none",
    borderColor: "var(--color-border-focus)",
    boxShadow: "var(--shadow-focus-ring), inset 0 0.5px 0 rgba(255, 255, 255, 0.06)",
  },
  ".cm-search button": {
    borderRadius: "var(--radius-control)",
    border: "1px solid var(--color-border-subtle)",
    background: "var(--color-bg-elevated)",
    color: "var(--color-text-secondary)",
    minHeight: "32px",
    minWidth: "56px",
    padding: "6px 12px",
    font: "inherit",
    fontSize: "var(--font-size-sm)",
    lineHeight: "1.2",
    boxShadow: "inset 0 0.5px 0 rgba(255, 255, 255, 0.04)",
    transition: "background var(--duration-fast) var(--ease-smooth), color var(--duration-fast) var(--ease-smooth)",
  },
  ".cm-search button:hover": {
    background: "rgba(255, 255, 255, 0.08)",
    color: "var(--color-text-primary)",
  },
  ".cm-search button:disabled": {
    opacity: 0.45,
  },
  ".cm-panel.cm-search button[name='close']": {
    position: "absolute",
    top: "6px",
    right: "6px",
    minHeight: "28px",
    minWidth: "28px",
    padding: "0",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: "var(--radius-control)",
    background: "var(--color-bg-elevated)",
    color: "var(--color-text-secondary)",
    fontSize: "var(--font-size-lg)",
    lineHeight: "0",
    cursor: "default",
  },
  ".cm-panel.cm-search button[name='close']:hover": {
    background: "var(--color-bg-hover)",
    color: "var(--color-text-primary)",
  },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    color: "var(--color-text-secondary)",
    fontSize: "var(--font-size-xs)",
    cursor: "default",
    lineHeight: "1",
  },
  ".cm-search label input[type='checkbox']": {
    appearance: "none",
    WebkitAppearance: "none",
    margin: "0",
    padding: "0",
    width: "13px",
    height: "13px",
    minWidth: "13px",
    borderRadius: "3px",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-elevated)",
    cursor: "default",
    flexShrink: "0",
    position: "relative",
    boxSizing: "border-box",
    transition: "background var(--duration-fast) var(--ease-smooth), border-color var(--duration-fast) var(--ease-smooth)",
  },
  ".cm-search label input[type='checkbox']:checked": {
    background: "var(--color-accent)",
    borderColor: "var(--color-accent)",
  },
  ".cm-search label input[type='checkbox']:checked::after": {
    content: '""',
    position: "absolute",
    top: "1px",
    left: "3px",
    width: "4px",
    height: "7px",
    border: "solid var(--color-text-primary)",
    borderWidth: "0 1.5px 1.5px 0",
    transform: "rotate(45deg)",
  },
  // Find-only 模式下隐藏 replace 行（DOM 上靠 data-search-mode='find' 控制）
  ".cm-panel.cm-search[data-search-mode='find'] input[name='replace']": {
    display: "none",
  },
  ".cm-panel.cm-search[data-search-mode='find'] button[name='replace']": {
    display: "none",
  },
  ".cm-panel.cm-search[data-search-mode='find'] button[name='replaceAll']": {
    display: "none",
  },
  ".cm-panel.cm-search[data-search-mode='find'] br": {
    display: "none",
  },
  // Replace 模式下隐藏纯查找用的导航按钮（next / prev / select all）。
  // 搜索输入框、匹配修饰符（match case / regexp / by word）、关闭按钮保留。
  ".cm-panel.cm-search[data-search-mode='replace'] button[name='next']": {
    display: "none",
  },
  ".cm-panel.cm-search[data-search-mode='replace'] button[name='prev']": {
    display: "none",
  },
  ".cm-panel.cm-search[data-search-mode='replace'] button[name='select']": {
    display: "none",
  },
  ".cm-dialog": {
    // Dialog 跟 search panel 共享 .cm-panels-top 的玻璃背景与 borderBottom，
    // 自身不再独立加 background / backdropFilter / border，避免边框叠加
    // 出现"上下两条线"的违和感。
    position: "relative",
    background: "transparent",
    color: "var(--color-text-primary)",
    padding: "10px 44px 10px 12px",
  },
  ".cm-dialog form": {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
  },
  ".cm-dialog label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    color: "var(--color-text-secondary)",
    fontSize: "var(--font-size-sm)",
  },
  ".cm-dialog .cm-textfield": {
    minWidth: "120px",
    borderRadius: "var(--radius-control)",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-elevated)",
    color: "var(--color-text-primary)",
    padding: "7px 10px",
    font: "inherit",
    boxShadow: "inset 0 0.5px 0 rgba(255, 255, 255, 0.05)",
  },
  ".cm-dialog .cm-textfield:focus": {
    outline: "none",
    borderColor: "var(--color-border-focus)",
    boxShadow: "var(--shadow-focus-ring), inset 0 0.5px 0 rgba(255, 255, 255, 0.06)",
  },
  ".cm-dialog .cm-button": {
    minHeight: "32px",
    minWidth: "56px",
    borderRadius: "var(--radius-control)",
    border: "1px solid var(--color-border-subtle)",
    background: "var(--color-bg-elevated)",
    color: "var(--color-text-secondary)",
    padding: "6px 12px",
    font: "inherit",
    fontSize: "var(--font-size-sm)",
  },
  ".cm-dialog .cm-button:hover": {
    background: "var(--color-bg-hover)",
    color: "var(--color-text-primary)",
  },
  ".cm-dialog-close": {
    position: "absolute",
    top: "8px",
    right: "8px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "28px",
    minHeight: "28px",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: "var(--radius-control)",
    background: "var(--color-bg-elevated)",
    color: "var(--color-text-secondary)",
    fontSize: "var(--font-size-lg)",
    lineHeight: "0",
    cursor: "default",
    padding: "0",
  },
  ".cm-dialog-close:hover": {
    background: "var(--color-bg-hover)",
    color: "var(--color-text-primary)",
  },
  ".cm-searchMatch": {
    backgroundColor: "rgba(245, 158, 11, 0.28)",
    outline: "1px solid rgba(245, 158, 11, 0.35)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "rgba(59, 130, 246, 0.32)",
    outline: "1px solid rgba(59, 130, 246, 0.40)",
  },
});

function normalizeEditorValue(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function resolveLanguage(remotePath: string): { extension: Extension; label: string } {
  const lowerPath = remotePath.toLowerCase();
  const fileName = lowerPath.split("/").pop() ?? lowerPath;
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";

  if (extension === ".json") return { extension: json(), label: "JSON" };
  if (extension === ".yaml" || extension === ".yml") return { extension: yaml(), label: "YAML" };
  if (extension === ".md" || extension === ".markdown") return { extension: markdown(), label: "Markdown" };
  if (extension === ".toml") return { extension: tomlLanguage, label: "TOML" };
  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) {
    return { extension: dockerfileLanguage, label: "Dockerfile" };
  }
  if (fileName.startsWith(".env") || extension === ".env") {
    return { extension: envLanguage, label: "ENV" };
  }
  if (fileName === "nginx.conf" || lowerPath.includes("/nginx/") || extension === ".nginx") {
    return { extension: nginxLanguage, label: "Nginx" };
  }
  if (extension === ".service" || extension === ".timer" || extension === ".socket") {
    return { extension: envLanguage, label: "systemd" };
  }
  if ([".sh", ".bash", ".zsh", ".profile"].includes(extension)) {
    return { extension: shellLanguage, label: "Shell" };
  }
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(extension)) {
    return { extension: javascriptLanguage, label: "JS/TS" };
  }
  if ([".css", ".scss", ".sass"].includes(extension)) {
    return { extension: cssLanguage, label: "CSS" };
  }
  if ([".xml", ".svg", ".html", ".htm"].includes(extension)) {
    return { extension: xmlLanguage, label: "XML/HTML" };
  }
  if (extension === ".py") {
    return { extension: pythonLanguage, label: "Python" };
  }
  if (extension === ".rs") {
    return { extension: rustLanguage, label: "Rust" };
  }
  if (extension === ".sql") {
    return { extension: sqlLanguage, label: "SQL" };
  }
  if ([".ini", ".conf", ".config", ".cfg", ".cnf", ".properties"].includes(extension)) {
    return { extension: envLanguage, label: "Config" };
  }

  return { extension: [], label: "Plain Text" };
}

function inferLineEnding(sample: string): QuickEditorLineEnding {
  const hasCrLf = sample.includes("\r\n");
  const hasLf = /(^|[^\r])\n/.test(sample);

  if (hasCrLf && hasLf) return "mixed";
  if (hasCrLf) return "CRLF";
  if (hasLf) return "LF";
  return sample.length > 0 ? "unknown" : "LF";
}

function inferIndentStyle(sample: string): QuickEditorIndentStyle {
  const lines = sample.split(/\r?\n/).slice(0, 200);
  let tabCount = 0;
  let spaces2Count = 0;
  let spaces4Count = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("\t")) {
      tabCount += 1;
      continue;
    }

    const spacesMatch = line.match(/^( +)\S/);
    if (!spacesMatch) continue;

    const indentWidth = spacesMatch[1].length;
    if (indentWidth >= 4 && indentWidth % 4 === 0) {
      spaces4Count += 1;
    } else if (indentWidth >= 2 && indentWidth % 2 === 0) {
      spaces2Count += 1;
    }
  }

  if (tabCount === 0 && spaces2Count === 0 && spaces4Count === 0) return "unknown";
  if (tabCount >= spaces2Count && tabCount >= spaces4Count) return "tab";
  if (spaces4Count >= spaces2Count) return "spaces-4";
  return "spaces-2";
}

function getEditorStatus(
  view: EditorView,
  remotePath: string,
  lineEndingOverride?: QuickEditorLineEnding,
): QuickEditorStatus {
  const cursor = view.state.selection.main.head;
  const line = view.state.doc.lineAt(cursor);
  const sample = view.state.doc.sliceString(0, Math.min(view.state.doc.length, 16000));

  return {
    line: line.number,
    column: cursor - line.from + 1,
    lineEnding: lineEndingOverride ?? inferLineEnding(sample),
    indentStyle: inferIndentStyle(sample),
    language: resolveLanguage(remotePath).label,
  };
}

function replaceDocument(view: EditorView, nextValue: string) {
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: nextValue,
    },
    selection: EditorSelection.cursor(0),
    scrollIntoView: true,
  });
}

export const QuickEditor = forwardRef<QuickEditorHandle, QuickEditorProps>(function QuickEditor({
  value,
  baselineValue,
  remotePath,
  readOnly = false,
  autoFocus = false,
  findRequestToken,
  gotoLineRequestToken,
  phrases = {},
  contextMenuLabels,
  className,
  onChange,
  onDirtyChange,
  onSaveRequest,
  onFindRequest,
  onStatusChange,
}, ref) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const lastRemotePathRef = useRef(remotePath);
  const lastFindRequestTokenRef = useRef(findRequestToken);
  const lastGotoLineRequestTokenRef = useRef(gotoLineRequestToken);
  const baselineValueRef = useRef(normalizeEditorValue(baselineValue ?? value));
  const lineEndingRef = useRef(inferLineEnding(baselineValue ?? value));
  // 当前希望的查找面板模式。toolbar 按钮、Cmd+F、Cmd+Alt+F 都通过它驱动。
  const searchModeRef = useRef<"find" | "replace">("find");
  const onChangeRef = useRef(onChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onSaveRequestRef = useRef(onSaveRequest);
  const onFindRequestRef = useRef(onFindRequest);
  const onStatusChangeRef = useRef(onStatusChange);

  useImperativeHandle(ref, () => {
    /**
     * Toolbar 行为：开/关 + 切 mode。
     *  - 面板未开：以指定 mode 打开
     *  - 已开同 mode：关闭
     *  - 已开不同 mode：切换 mode（不重开 panel）
     * mode = "replace" 时把焦点放到 replace 输入框，便于直接替换。
     */
    const toggleMode = (mode: "find" | "replace") => {
      const view = viewRef.current;
      if (!view) return;

      if (searchPanelOpen(view.state)) {
        if (searchModeRef.current === mode) {
          closeSearchPanel(view);
          view.focus();
          return;
        }
        searchModeRef.current = mode;
        applySearchModeToActivePanel(view, mode);
        if (mode === "replace") {
          requestAnimationFrame(() => focusSearchPanelReplaceInput(view));
        } else {
          requestAnimationFrame(() => focusSearchPanelMainInput(view));
        }
        return;
      }

      closeAnyDialog(view);
      searchModeRef.current = mode;
      openSearchPanel(view);
      applySearchModeToActivePanel(view, mode);
      if (mode === "replace") {
        requestAnimationFrame(() => focusSearchPanelReplaceInput(view));
      }
    };

    /** Programmatic open（不 toggle）：保证以指定 mode 打开并聚焦。 */
    const openWithMode = (mode: "find" | "replace") => {
      const view = viewRef.current;
      if (!view) return;
      closeAnyDialog(view);
      searchModeRef.current = mode;
      if (!searchPanelOpen(view.state)) openSearchPanel(view);
      applySearchModeToActivePanel(view, mode);
      requestAnimationFrame(() => {
        if (mode === "replace") focusSearchPanelReplaceInput(view);
        else focusSearchPanelMainInput(view);
      });
    };

    return {
      focus: () => viewRef.current?.focus(),
      openSearch: () => openWithMode("find"),
      openReplace: () => openWithMode("replace"),
      openGotoLine: () => {
        const view = viewRef.current;
        if (!view) return;
        const existingDialog = getDialog(view, "cm-dialog");
        if (existingDialog) {
          existingDialog.dom.querySelector<HTMLInputElement>("input")?.focus();
          return;
        }
        closeSearchPanel(view);
        gotoLine(view);
      },
      toggleSearch: () => toggleMode("find"),
      toggleSearchReplace: () => toggleMode("replace"),
      toggleGotoLine: () => {
        const view = viewRef.current;
        if (!view) return;
        const existingDialog = getDialog(view, "cm-dialog");
        if (existingDialog) {
          existingDialog.dom.querySelector<HTMLButtonElement>(".cm-dialog-close")?.click();
          view.focus();
          return;
        }
        closeSearchPanel(view);
        gotoLine(view);
      },
    };
  }, []);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    onSaveRequestRef.current = onSaveRequest;
  }, [onSaveRequest]);

  useEffect(() => {
    onFindRequestRef.current = onFindRequest;
  }, [onFindRequest]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    if (!hostRef.current) return;

    const initialExtensions: Extension[] = [
      lineNumbers(),
      highlightSpecialChars(),
      drawSelection(),
      history(),
      search({ top: true }),
      highlightSelectionMatches(),
      quickEditorTheme,
      phrasesCompartment.of(EditorState.phrases.of(phrases)),
      languageCompartment.of(resolveLanguage(remotePath).extension),
      editableCompartment.of(EditorView.editable.of(!readOnly)),
      readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
      EditorView.contentAttributes.of({
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
        "data-gramm": "false",
      }),
      Prec.high(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRequestRef.current?.();
              return true;
            },
          },
          {
            key: "Mod-f",
            preventDefault: true,
            run: (view) => {
              closeAnyDialog(view);
              searchModeRef.current = "find";
              const wasOpen = searchPanelOpen(view.state);
              if (!wasOpen) openSearchPanel(view);
              applySearchModeToActivePanel(view, "find");
              requestAnimationFrame(() => focusSearchPanelMainInput(view));
              if (!wasOpen) onFindRequestRef.current?.();
              return true;
            },
          },
          {
            key: "Mod-Alt-f",
            preventDefault: true,
            run: (view) => {
              closeAnyDialog(view);
              searchModeRef.current = "replace";
              const wasOpen = searchPanelOpen(view.state);
              if (!wasOpen) openSearchPanel(view);
              applySearchModeToActivePanel(view, "replace");
              requestAnimationFrame(() => focusSearchPanelReplaceInput(view));
              if (!wasOpen) onFindRequestRef.current?.();
              return true;
            },
          },
          {
            key: "Escape",
            run: (view) => closeSearchPanel(view),
          },
        ]),
      ),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const nextValue = update.state.doc.toString();
          onChangeRef.current(nextValue);
          onDirtyChangeRef.current?.(nextValue !== baselineValueRef.current);
        }

        if (update.docChanged || update.selectionSet) {
          onStatusChangeRef.current?.(getEditorStatus(update.view, lastRemotePathRef.current, lineEndingRef.current));
        }
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: normalizeEditorValue(value),
        extensions: initialExtensions,
      }),
      parent: hostRef.current,
    });

    viewRef.current = view;
    const initialValue = normalizeEditorValue(value);
    baselineValueRef.current = normalizeEditorValue(baselineValue ?? value);
    onDirtyChangeRef.current?.(initialValue !== baselineValueRef.current);
    onStatusChangeRef.current?.(getEditorStatus(view, lastRemotePathRef.current, lineEndingRef.current));

    if (autoFocus) {
      requestAnimationFrame(() => view.focus());
    }

    return () => {
      if (document.body.dataset.quickEditorFocus === "true") {
        delete document.body.dataset.quickEditorFocus;
      }
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: phrasesCompartment.reconfigure(EditorState.phrases.of(phrases)),
    });
  }, [phrases]);

  useEffect(() => {
    const panelsContainer = hostRef.current?.querySelector(".cm-panels") as HTMLElement | null;
    if (!panelsContainer) return;

    let closingTimer: ReturnType<typeof setTimeout> | null = null;
    const panelOutDuration = 150;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // panel 新增：写入当前期望的 search-mode，让 CSS 控制 replace 行的可见性。
        // 这是 panel 第一次打开 / 通过快捷键打开的兜底路径。
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("cm-search")) {
            node.dataset.searchMode = searchModeRef.current;
          }
        }
        for (const node of mutation.removedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("cm-panel")) {
            node.classList.add("cm-panel-closing");
            closingTimer = setTimeout(() => {
              if (node.parentNode) {
                node.parentNode.removeChild(node);
              }
              closingTimer = null;
            }, panelOutDuration);
            panelsContainer.appendChild(node);
          }
        }
      }
    });

    observer.observe(panelsContainer, { childList: true });

    return () => {
      observer.disconnect();
      if (closingTimer !== null) clearTimeout(closingTimer);
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: languageCompartment.reconfigure(resolveLanguage(remotePath).extension),
    });
    onStatusChangeRef.current?.(getEditorStatus(view, remotePath, lineEndingRef.current));
  }, [remotePath]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: [
        editableCompartment.reconfigure(EditorView.editable.of(!readOnly)),
        readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
      ],
    });
  }, [readOnly]);

  useEffect(() => {
    if (baselineValue !== undefined) {
      baselineValueRef.current = normalizeEditorValue(baselineValue);
      lineEndingRef.current = inferLineEnding(baselineValue);
    }

    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    onDirtyChangeRef.current?.(currentValue !== baselineValueRef.current);
    onStatusChangeRef.current?.(getEditorStatus(view, lastRemotePathRef.current, lineEndingRef.current));
  }, [baselineValue]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const remotePathChanged = lastRemotePathRef.current !== remotePath;
    if (remotePathChanged) {
      baselineValueRef.current = normalizeEditorValue(baselineValue ?? value);
      lineEndingRef.current = inferLineEnding(baselineValue ?? value);
      lastRemotePathRef.current = remotePath;
    }

    const nextValue = normalizeEditorValue(value);
    const currentValue = view.state.doc.toString();
    if (currentValue === nextValue) return;

    replaceDocument(view, nextValue);
    onDirtyChangeRef.current?.(nextValue !== baselineValueRef.current);
    onStatusChangeRef.current?.(getEditorStatus(view, lastRemotePathRef.current, lineEndingRef.current));

    if (autoFocus) {
      requestAnimationFrame(() => view.focus());
    }
  }, [autoFocus, remotePath, value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (findRequestToken === undefined || findRequestToken === lastFindRequestTokenRef.current) return;

    lastFindRequestTokenRef.current = findRequestToken;
    closeAnyDialog(view);
    openSearchPanel(view);
    requestAnimationFrame(() => view.focus());
  }, [findRequestToken]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (
      gotoLineRequestToken === undefined ||
      gotoLineRequestToken === lastGotoLineRequestTokenRef.current
    ) {
      return;
    }

    lastGotoLineRequestTokenRef.current = gotoLineRequestToken;
    const existingDialog = getDialog(view, "cm-dialog");
    if (existingDialog) {
      existingDialog.dom.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    closeSearchPanel(view);
    gotoLine(view);
  }, [gotoLineRequestToken]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeMenu);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenu]);

  const getSelectionText = () => {
    const view = viewRef.current;
    if (!view) return "";
    const selection = view.state.selection.main;
    if (selection.empty) return "";
    return view.state.sliceDoc(selection.from, selection.to);
  };

  const copySelection = async () => {
    const selectedText = getSelectionText();
    if (!selectedText) return;
    await writeClipboardText(selectedText);
  };

  const cutSelection = async () => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const selection = view.state.selection.main;
    if (selection.empty) return;
    await writeClipboardText(view.state.sliceDoc(selection.from, selection.to));
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: "" },
      scrollIntoView: true,
    });
    view.focus();
  };

  const pasteText = async () => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const text = await readClipboardText();
    if (!text) return;
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: normalizeEditorValue(text) },
      selection: EditorSelection.cursor(selection.from + normalizeEditorValue(text).length),
      scrollIntoView: true,
    });
    view.focus();
  };

  const selectAllText = () => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });
    view.focus();
  };

  return (
    <div
      ref={wrapperRef}
      data-quick-editor-root="true"
      data-allow-native-contextmenu="true"
      className={cn("quick-editor-shell", className)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
      onFocusCapture={() => {
        document.body.dataset.quickEditorFocus = "true";
      }}
      onBlurCapture={(event) => {
        if (wrapperRef.current?.contains(event.relatedTarget as Node | null)) return;
        delete document.body.dataset.quickEditorFocus;
      }}
    >
      <div ref={hostRef} className="h-full min-h-0" />
      {contextMenu && (
        <div
          className="quick-editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" disabled={readOnly || !getSelectionText()} onClick={() => { setContextMenu(null); void cutSelection(); }}>
            {contextMenuLabels.cut}
          </button>
          <button type="button" disabled={!getSelectionText()} onClick={() => { setContextMenu(null); void copySelection(); }}>
            {contextMenuLabels.copy}
          </button>
          <button type="button" disabled={readOnly} onClick={() => { setContextMenu(null); void pasteText(); }}>
            {contextMenuLabels.paste}
          </button>
          <div className="quick-editor-context-menu-separator" />
          <button type="button" onClick={() => { setContextMenu(null); selectAllText(); }}>
            {contextMenuLabels.selectAll}
          </button>
        </div>
      )}
    </div>
  );
});
