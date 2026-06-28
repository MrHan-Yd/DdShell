import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle,
  Clipboard,
  Lock,
  RefreshCw,
  Save,
  Search,
  Terminal,
  X,
} from "lucide-react";
import { emit } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/themed/Input";
import { writeClipboardText } from "@/lib/clipboard";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { confirm } from "@/stores/confirm";
import { toast } from "@/stores/toast";
import { useQuickEditStore } from "@/stores/quickEdit";
import { QuickEditor, type QuickEditorHandle } from "../sftp/components/QuickEditor";
import {
  formatBytes,
  formatIndent,
  formatLineEnding,
  formatTime,
  getErrorMessage,
  getQuickEditRiskNotice,
} from "./utils";

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

type Props = { tabId: string };

export function QuickEditTabContent({ tabId }: Props) {
  const t = useT();
  const tab = useQuickEditStore((s) => s.tabs.find((x) => x.id === tabId));
  const editorRef = useRef<QuickEditorHandle | null>(null);
  const draftContentRef = useRef<string>("");

  const tabIdSafe = tab?.id;
  const baseline = tab?.baselineContent ?? "";

  // Reset the draft ref when the tab is (re)loaded.
  useEffect(() => {
    draftContentRef.current = baseline;
  }, [tabIdSafe, baseline]);

  const editorPhrases = useMemo(() => ({
    "Go to line": t("quickEdit.cmGoToLine"),
    go: t("quickEdit.cmGo"),
    "replaced match on line $": t("quickEdit.cmReplacedMatchOnLine"),
    "replaced $ matches": t("quickEdit.cmReplacedMatches"),
    Find: t("quickEdit.cmFind"),
    Replace: t("quickEdit.cmReplace"),
    next: t("quickEdit.cmNext"),
    previous: t("quickEdit.cmPrevious"),
    all: t("quickEdit.cmAll"),
    "match case": t("quickEdit.cmMatchCase"),
    regexp: t("quickEdit.cmRegexp"),
    "by word": t("quickEdit.cmByWord"),
    replace: t("quickEdit.cmReplaceButton"),
    "replace all": t("quickEdit.cmReplaceAll"),
    close: t("quickEdit.cmClose"),
    "current match": t("quickEdit.cmCurrentMatch"),
    "on line": t("quickEdit.cmOnLine"),
  }), [t]);

  const contextMenuLabels = useMemo(() => ({
    cut: t("quickEdit.contextCut"),
    copy: t("quickEdit.contextCopy"),
    paste: t("quickEdit.contextPaste"),
    selectAll: t("quickEdit.contextSelectAll"),
  }), [t]);

  const handleSave = useCallback(async () => {
    if (!tabIdSafe) return;
    await useQuickEditStore.getState().saveTab(tabIdSafe, t, draftContentRef.current);
  }, [tabIdSafe, t]);

  const handlePrivilegedSave = useCallback(async () => {
    if (!tabIdSafe) return;
    await useQuickEditStore
      .getState()
      .privilegedSaveTab(tabIdSafe, t, draftContentRef.current);
  }, [tabIdSafe, t]);

  const handleReload = useCallback(async () => {
    if (!tab) return;
    if (tab.dirty) {
      const ok = await confirm({
        title: t("quickEdit.reload"),
        description: t("quickEdit.unsavedCloseDesc"),
        confirmLabel: t("quickEdit.reload"),
        cancelLabel: t("confirm.cancel"),
      });
      if (!ok) return;
    }
    await useQuickEditStore.getState().reloadTab(tab.id);
  }, [tab, t]);

  const handleCopyCommand = useCallback(async (command: string) => {
    try {
      await writeClipboardText(command);
      toast.success(t("quickEdit.actionCopied"));
    } catch {
      toast.error(t("quickEdit.actionCopyFailed"));
    }
  }, [t]);

  const handleFillTerminal = useCallback(async (command: string) => {
    if (!tab) return;
    try {
      await emit("terminal:insert-text", { sessionId: tab.sessionId, text: command });
      toast.success(t("quickEdit.actionFilledTerminal"));
    } catch {
      toast.error(t("quickEdit.actionCopyFailed"));
    }
  }, [tab, t]);

  const riskNotice = useMemo(
    () => (tab ? getQuickEditRiskNotice(tab.remotePath, t) : null),
    [tab, t],
  );

  const headerStatus = useMemo(() => {
    if (!tab) return "";
    if (tab.sessionDetached) return t("quickEdit.sessionDetached");
    if (tab.viewState === "saving") return t("quickEdit.statusSaving");
    if (tab.viewState === "conflict") return t("quickEdit.statusConflict");
    if (tab.errorCode) return getErrorMessage(t, tab.errorCode);
    if (tab.dirty) return t("quickEdit.unsaved");
    return tab.statusMessage || t("status.ready");
  }, [tab, t]);

  if (!tab) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-muted)]">
        {t("quickEdit.window.empty")}
      </div>
    );
  }

  const detached = tab.sessionDetached;
  const readonly = (tab.remoteFile?.readonly ?? false) || detached;
  const canEdit = tab.viewState === "ready" || tab.viewState === "saving" || tab.viewState === "conflict";
  const canSave = !detached && tab.viewState === "ready" && !readonly && tab.dirty;
  const canPrivilegedSave = !detached && Boolean(
    tab.remoteFile && tab.dirty && (
      readonly ||
      tab.errorCode === "FILE_PERMISSION_DENIED" ||
      tab.errorCode === "SUDO_AUTH_FAILED"
    ),
  );

  const setShowPrivilegedSave = (show: boolean) =>
    useQuickEditStore.getState().setShowPrivilegedSave(tab.id, show);
  const setSudoPassword = (value: string) =>
    useQuickEditStore.getState().setSudoPassword(tab.id, value);
  const setCreateBackup = (value: boolean) =>
    useQuickEditStore.getState().setCreateBackup(tab.id, value);
  const setEditorStatus = (status: typeof tab.editorStatus) =>
    useQuickEditStore.getState().setEditorStatus(tab.id, status);
  const setStatusMessage = (msg: string) =>
    useQuickEditStore.getState().setStatusMessage(tab.id, msg);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg-base)]">
      {/* Path + status header */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] text-[var(--color-text-muted)]">{tab.remotePath}</span>
            <span className="quick-edit-badge quick-edit-badge--status">{headerStatus}</span>
          </div>
        </div>
        {detached && (
          <span className="quick-edit-badge quick-edit-badge--muted inline-flex items-center gap-1 text-[var(--color-error)]">
            <Lock size={11} />
            {t("quickEdit.sessionDetached")}
          </span>
        )}
        {readonly && !detached && (
          <span className="quick-edit-badge quick-edit-badge--muted inline-flex items-center gap-1">
            <Lock size={11} />
            {t("quickEdit.readonly")}
          </span>
        )}
        {tab.dirty && (
          <span className="quick-edit-badge quick-edit-badge--accent">{t("quickEdit.unsaved")}</span>
        )}
      </div>

      {/* Toolbar */}
      <div className="quick-edit-toolbar flex flex-wrap items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-2">
        <div className="quick-edit-toolbar-group">
          <Button size="sm" variant="secondary" onClick={() => void handleSave()} disabled={!canSave}>
            {tab.viewState === "saving" ? <Spinner /> : <Save size={14} />}
            {t("quickEdit.save")}
          </Button>
          {canPrivilegedSave && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowPrivilegedSave(true)}
              disabled={tab.viewState === "saving"}
            >
              <Lock size={14} />
              {t("quickEdit.useSudoSave")}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleReload()}
            disabled={tab.viewState === "loading" || tab.viewState === "saving" || detached}
          >
            {tab.viewState === "loading" ? <Spinner /> : <RefreshCw size={14} />}
            {t("quickEdit.reload")}
          </Button>
        </div>

        <div className="quick-edit-toolbar-group">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editorRef.current?.toggleSearch()}
            disabled={!canEdit}
          >
            <Search size={14} />
            {t("quickEdit.find")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editorRef.current?.toggleSearchReplace()}
            disabled={!canEdit}
          >
            {t("quickEdit.searchReplace")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editorRef.current?.toggleGotoLine()}
            disabled={!canEdit}
          >
            {t("quickEdit.gotoLine")}
          </Button>
        </div>

        <div className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-muted)]">
          {t("quickEdit.searchReplaceHint")}
        </div>
      </div>

      {/* Editor stage */}
      <div className="quick-edit-editor-stage flex min-h-0 flex-1 flex-col">
        {riskNotice && tab.remoteFile && (
          <div
            className={cn(
              "mx-4 mt-4 rounded-[var(--radius-control)] border px-3 py-2 text-[var(--font-size-sm)] shadow-[var(--border-hairline-inner)]",
              riskNotice.level === "high"
                ? "border-[var(--color-error)]/30 bg-[var(--color-error)]/8 text-[var(--color-text-secondary)]"
                : "border-[var(--color-warning)]/25 bg-[var(--color-warning)]/8 text-[var(--color-text-secondary)]",
            )}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                size={15}
                className={cn(
                  "mt-0.5 shrink-0",
                  riskNotice.level === "high" ? "text-[var(--color-error)]" : "text-[var(--color-warning)]",
                )}
              />
              <div>
                <div className="text-[var(--color-text-primary)]">{riskNotice.title}</div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{riskNotice.description}</div>
              </div>
            </div>
          </div>
        )}

        {tab.remoteFile && (tab.errorCode === "FILE_PERMISSION_DENIED" || tab.errorCode === "SUDO_AUTH_FAILED") && tab.dirty && !detached && (
          <div className="mx-4 mt-4 rounded-[var(--radius-control)] border border-[var(--color-warning)]/25 bg-[var(--color-warning)]/8 px-3 py-2 text-[var(--font-size-sm)] text-[var(--color-text-secondary)] shadow-[var(--border-hairline-inner)]">
            <div className="flex items-center gap-3">
              <Lock size={15} className="shrink-0 text-[var(--color-warning)]" />
              <div className="min-w-0 flex-1">
                <div className="text-[var(--color-text-primary)]">{getErrorMessage(t, tab.errorCode ?? "FILE_PERMISSION_DENIED")}</div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{t("quickEdit.privilegedSaveHint")}</div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowPrivilegedSave(true)}
              >
                {t("quickEdit.useSudoSave")}
              </Button>
            </div>
          </div>
        )}

        {tab.remoteFile && tab.viewState === "conflict" && (
          <div className="mx-4 mt-4 rounded-[var(--radius-control)] border border-[var(--color-warning)]/25 bg-[var(--color-warning)]/8 px-3 py-2 text-[var(--font-size-sm)] text-[var(--color-text-secondary)] shadow-[var(--border-hairline-inner)]">
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
              <div>
                <div className="text-[var(--color-text-primary)]">{t("quickEdit.conflict")}</div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{t("quickEdit.conflictDetail")}</div>
              </div>
            </div>
          </div>
        )}

        {tab.viewState === "loading" && (
          <div className="flex h-full items-center justify-center gap-3 text-[var(--color-text-secondary)]">
            <Spinner className="h-[18px] w-[18px] text-[var(--color-accent)]" />
            <span>{t("quickEdit.loading")}</span>
          </div>
        )}

        {(tab.viewState === "error" || tab.viewState === "conflict") && !tab.remoteFile && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
              <AlertTriangle size={22} />
            </div>
            <div>
              <div className="text-[var(--font-size-base)] font-medium text-[var(--color-text-primary)]">
                {getErrorMessage(t, tab.errorCode ?? "UNKNOWN_ERROR")}
              </div>
              <div className="mt-1 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
                {tab.errorCode ?? "UNKNOWN_ERROR"}
              </div>
            </div>
            <Button variant="secondary" onClick={() => void useQuickEditStore.getState().reloadTab(tab.id)} disabled={detached}>
              <RefreshCw size={14} />
              {t("quickEdit.tryAgain")}
            </Button>
          </div>
        )}

        {tab.remoteFile && canEdit && (
          <div className="min-h-0 flex-1 px-4 pb-4 pt-3">
            <QuickEditor
              ref={editorRef}
              className="h-full"
              value={tab.baselineContent}
              baselineValue={tab.baselineContent}
              remotePath={tab.remotePath}
              readOnly={readonly || tab.viewState === "saving"}
              autoFocus
              phrases={editorPhrases}
              contextMenuLabels={contextMenuLabels}
              onChange={(nextValue) => {
                draftContentRef.current = nextValue;
              }}
              onDirtyChange={(nextDirty) => {
                const current = useQuickEditStore.getState().tabs.find((x) => x.id === tab.id);
                if (!current) return;
                if (current.dirty !== nextDirty) {
                  useQuickEditStore.getState().patchTab(tab.id, {
                    dirty: nextDirty,
                    ...(nextDirty ? { suggestedActions: [], lastBackupPath: null } : {}),
                  });
                }
                if (
                  nextDirty &&
                  (current.statusMessage === t("quickEdit.statusSaved") ||
                    current.statusMessage === t("quickEdit.savedPrivileged") ||
                    current.statusMessage === t("quickEdit.savedWithBackup"))
                ) {
                  setStatusMessage("");
                }
              }}
              onSaveRequest={() => { void handleSave(); }}
              onStatusChange={(nextStatus) => {
                const cur = useQuickEditStore.getState().tabs.find((x) => x.id === tab.id);
                if (!cur) return;
                const eq =
                  cur.editorStatus.line === nextStatus.line &&
                  cur.editorStatus.column === nextStatus.column &&
                  cur.editorStatus.lineEnding === nextStatus.lineEnding &&
                  cur.editorStatus.indentStyle === nextStatus.indentStyle &&
                  cur.editorStatus.language === nextStatus.language;
                if (!eq) setEditorStatus(nextStatus);
              }}
            />
          </div>
        )}

        {tab.remoteFile && !tab.dirty && (tab.lastBackupPath || tab.suggestedActions.length > 0) && (
          <div className="mx-4 mb-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]/70 px-3 py-3 shadow-[var(--border-hairline-inner)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                  {t("quickEdit.postSaveActions")}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {t("quickEdit.postSaveActionsHint")}
                </div>
              </div>
            </div>

            {tab.lastBackupPath && (
              <div className="mt-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/60 px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)]">
                {t("quickEdit.backupPath")}: <span className="font-mono text-[var(--color-text-primary)]">{tab.lastBackupPath}</span>
              </div>
            )}

            {tab.suggestedActions.length > 0 && (
              <div className="mt-2 space-y-2">
                {tab.suggestedActions.map((action) => (
                  <div
                    key={action.id}
                    className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/60 px-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] text-[var(--color-text-primary)]">{action.command}</div>
                      {action.description && (
                        <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{action.description}</div>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void handleCopyCommand(action.command)}>
                      <Clipboard size={13} />
                      {t("quickEdit.copyCommand")}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void handleFillTerminal(action.command)}>
                      <Terminal size={13} />
                      {t("quickEdit.fillTerminal")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="quick-edit-statusbar flex flex-wrap items-center gap-2 border-t border-[var(--color-border-subtle)] px-5 py-2 text-[11px] text-[var(--color-text-muted)]">
        <span className="quick-edit-status-pill">{tab.remoteFile?.encoding ?? "-"}</span>
        <span className="quick-edit-status-pill">{formatBytes(tab.remoteFile?.size ?? draftContentRef.current.length)}</span>
        <span className="quick-edit-status-pill">{formatTime(tab.remoteFile?.mtime ?? 0)}</span>
        <span className="quick-edit-status-pill">{`Ln ${tab.editorStatus.line}, Col ${tab.editorStatus.column}`}</span>
        <span className="quick-edit-status-pill">{formatLineEnding(tab.editorStatus.lineEnding)}</span>
        <span className="quick-edit-status-pill">{formatIndent(tab.editorStatus.indentStyle)}</span>
        <span className="quick-edit-status-pill">{tab.editorStatus.language}</span>
        {tab.statusMessage && <span className="quick-edit-status-pill text-[var(--color-text-secondary)]">{tab.statusMessage}</span>}
        {!tab.statusMessage && tab.errorCode && <span className="quick-edit-status-pill text-[var(--color-warning)]">{getErrorMessage(t, tab.errorCode)}</span>}
        <div className="flex-1" />
        {readonly && <span className="quick-edit-status-pill">{t("quickEdit.statusReadonly")}</span>}
        {tab.dirty && <span className="quick-edit-status-pill text-[var(--color-accent)]">{t("quickEdit.unsaved")}</span>}
      </div>

      {/* Privileged save subdialog */}
      {tab.showPrivilegedSave && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 p-6 backdrop-blur-[8px]">
          <div className="glass-card w-full max-w-[420px] rounded-[var(--radius-popover)] border border-[var(--color-border)] p-5 shadow-[var(--shadow-modal)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[var(--font-size-lg)] font-semibold text-[var(--color-text-primary)]">
                  {t("quickEdit.privilegedSaveTitle")}
                </h3>
                <p className="mt-1 text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                  {t("quickEdit.privilegedSaveDesc")}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (tab.viewState === "saving") return;
                  setShowPrivilegedSave(false);
                }}
              >
                <X size={16} />
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                  {t("quickEdit.sudoPassword")}
                </label>
                <Input
                  type="password"
                  autoFocus
                  value={tab.sudoPassword}
                  error={tab.sudoPasswordError}
                  placeholder={t("quickEdit.sudoPasswordPlaceholder")}
                  onChange={(event) => {
                    setSudoPassword(event.target.value);
                    if (tab.sudoPasswordError) {
                      useQuickEditStore.getState().patchTab(tab.id, { sudoPasswordError: false });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handlePrivilegedSave();
                    }
                  }}
                />
              </div>

              <label className="flex items-center gap-2 text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={tab.createBackup}
                  onChange={(event) => setCreateBackup(event.target.checked)}
                  className="h-4 w-4 rounded border border-[var(--color-border)] bg-transparent accent-[var(--color-accent)]"
                />
                {t("quickEdit.createBackup")}
              </label>

              <p className="text-[11px] text-[var(--color-text-muted)]">
                {t("quickEdit.privilegedSaveHint")}
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowPrivilegedSave(false)}
                disabled={tab.viewState === "saving"}
              >
                {t("confirm.cancel")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => { void handlePrivilegedSave(); }}
                disabled={tab.viewState === "saving"}
              >
                {tab.viewState === "saving" ? <Spinner /> : <Lock size={14} />}
                {t("quickEdit.useSudoSave")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
