import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, History, Loader2, Send, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import * as api from "@/lib/tauri";
import type { AiAgentCommand, AiAgentConfig, AiAgentProfile, AiAgentSendResponse, TerminalTab } from "@/types";
import { useT } from "@/lib/i18n";
import { confirm } from "@/stores/confirm";
import { toast } from "@/stores/toast";

type TerminalAiAssistProps = {
  open: boolean;
  activeTab: TerminalTab | undefined;
  cwd: string | null;
  onClose: () => void;
  onRunCommand: (command: string, appendEnter: boolean) => void;
};

type AiHistoryItem = {
  id: string;
  question: string;
  response: AiAgentSendResponse;
  createdAt: number;
};

const AI_HISTORY_LIMIT = 20;
const AI_HISTORY_STORAGE_PREFIX = "terminal.aiAssist.history.";

const DEFAULT_CONFIG: AiAgentConfig = {
  enabled: false,
  defaultProfileId: null,
  executionMode: "run",
  confirmBeforeExecute: true,
  showReasoning: false,
  profiles: [],
};

const isHistoryItem = (value: unknown): value is AiHistoryItem => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AiHistoryItem>;
  return (
    typeof item.id === "string" &&
    typeof item.question === "string" &&
    typeof item.createdAt === "number" &&
    Boolean(item.response) &&
    typeof item.response?.answer === "string" &&
    Array.isArray(item.response?.commands)
  );
};

const normalizeResponse = (response: AiAgentSendResponse): AiAgentSendResponse => ({
  ...response,
  commandMode: response.commandMode === "steps" ? "steps" : "alternatives",
  reasoning: typeof response.reasoning === "string" && response.reasoning.trim() ? response.reasoning.trim() : null,
});

const getHistoryStorageKey = (hostId: string) => `${AI_HISTORY_STORAGE_PREFIX}${hostId}`;

const readHistoryItems = (hostId: string): AiHistoryItem[] => {
  if (!hostId) return [];
  try {
    const raw = window.localStorage.getItem(getHistoryStorageKey(hostId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryItem).slice(0, AI_HISTORY_LIMIT);
  } catch {
    return [];
  }
};

const writeHistoryItems = (hostId: string, items: AiHistoryItem[]) => {
  if (!hostId) return;
  try {
    window.localStorage.setItem(getHistoryStorageKey(hostId), JSON.stringify(items.slice(0, AI_HISTORY_LIMIT)));
  } catch {
    // localStorage may be unavailable or full; keep the in-memory list usable.
  }
};

const addHistoryItem = (hostId: string, item: AiHistoryItem) => {
  const next = [item, ...readHistoryItems(hostId)].slice(0, AI_HISTORY_LIMIT);
  writeHistoryItems(hostId, next);
  return next;
};

export function TerminalAiAssist({
  open,
  activeTab,
  cwd,
  onClose,
  onRunCommand,
}: TerminalAiAssistProps) {
  const t = useT();
  const [config, setConfig] = useState<AiAgentConfig>(DEFAULT_CONFIG);
  const [profileId, setProfileId] = useState("");
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [response, setResponse] = useState<AiAgentSendResponse | null>(null);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [historyItems, setHistoryItems] = useState<AiHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState("");
  const historyHostId = activeTab?.hostId || "";
  const historyHostIdRef = useRef(historyHostId);

  const loadConfig = useCallback(async () => {
    try {
      const next = await api.aiAgentConfigGet();
      setConfig(next);
      setProfileId((current) => {
        if (current && next.profiles.some((profile) => profile.id === current)) return current;
        return next.defaultProfileId || next.profiles[0]?.id || "";
      });
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    const handler = () => void loadConfig();
    window.addEventListener("terminal:settings-changed", handler);
    return () => window.removeEventListener("terminal:settings-changed", handler);
  }, [loadConfig]);

  useEffect(() => {
    if (open) void loadConfig();
  }, [loadConfig, open]);

  useEffect(() => {
    historyHostIdRef.current = historyHostId;
    setHistoryItems(readHistoryItems(historyHostId));
    setLastQuestion("");
    setResponse(null);
    setActiveCommandIndex(0);
    setShowHistory(false);
    setShowReasoning(false);
    setRequestStartedAt(null);
    setElapsedSec(0);
    setError("");
  }, [historyHostId]);

  useEffect(() => {
    if (!loading || requestStartedAt === null) return undefined;
    const updateElapsed = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - requestStartedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 500);
    return () => window.clearInterval(timer);
  }, [loading, requestStartedAt]);

  const selectedProfile: AiAgentProfile | undefined = useMemo(
    () => config.profiles.find((profile) => profile.id === profileId),
    [config.profiles, profileId],
  );

  const activeCommand: AiAgentCommand | undefined = response?.commands[activeCommandIndex];
  const canSend = Boolean(config.enabled && selectedProfile && selectedProfile.apiKeySet && question.trim() && activeTab);

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !selectedProfile || !activeTab) return;
    const submitHostId = activeTab.hostId;
    if (!selectedProfile.apiKeySet) {
      setError(t("aiAssist.missingKey"));
      return;
    }

    const startedAt = Date.now();
    setLoading(true);
    setRequestStartedAt(startedAt);
    setElapsedSec(0);
    setError("");
    setLastQuestion(trimmed);
    setResponse(null);
    setActiveCommandIndex(0);
    setShowHistory(false);
    setShowReasoning(false);
    try {
      const result = await api.aiAgentSend({
        profileId: selectedProfile.id,
        question: trimmed,
        context: {
          tabTitle: activeTab.title,
          cwd,
          selectedText: null,
        },
      });
      const historyItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        question: trimmed,
        response: normalizeResponse(result),
        createdAt: Date.now(),
      };
      const nextHistoryItems = addHistoryItem(submitHostId, historyItem);
      if (historyHostIdRef.current === submitHostId) {
        setResponse(normalizeResponse(result));
        setHistoryItems(nextHistoryItems);
        setQuestion("");
      }
    } catch (err) {
      if (historyHostIdRef.current === submitHostId) {
        setError(String(err));
      }
    } finally {
      if (historyHostIdRef.current === submitHostId) {
        setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      }
      setLoading(false);
    }
  };

  const restoreHistoryItem = (item: AiHistoryItem) => {
    setLastQuestion(item.question);
    setResponse(normalizeResponse(item.response));
    setActiveCommandIndex(0);
    setShowHistory(false);
    setShowReasoning(false);
    setRequestStartedAt(null);
    setElapsedSec(0);
    setError("");
  };

  const handleRun = async (command: AiAgentCommand) => {
    if (config.confirmBeforeExecute) {
      const confirmLabel = response?.commandMode === "steps"
        ? (config.executionMode === "run" ? t("aiAssist.runStep") : t("aiAssist.insertStep"))
        : (config.executionMode === "run" ? t("aiAssist.runCommand") : t("aiAssist.insertCommand"));
      const ok = await confirm({
        title: t("aiAssist.runConfirmTitle"),
        description: `${command.command}\n\n${command.description}`,
        confirmLabel,
        cancelLabel: t("confirm.cancel"),
        confirmVariant: command.risk === "high" ? "danger" : "default",
      });
      if (!ok) return;
    }
    onRunCommand(command.command, config.executionMode === "run");
    if (response?.commandMode === "steps" && activeCommandIndex < response.commands.length - 1) {
      setActiveCommandIndex((index) => Math.min(index + 1, response.commands.length - 1));
    }
  };

  const handleCopy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(t("aiAssist.copied"));
    } catch {
      toast.error(t("aiAssist.copyFailed"));
    }
  };

  const confidenceLabel = (confidence: AiAgentCommand["confidence"]) => {
    if (confidence === "high") return t("aiAssist.confidenceHigh");
    if (confidence === "medium") return t("aiAssist.confidenceMedium");
    if (confidence === "low") return t("aiAssist.confidenceLow");
    return confidence;
  };

  const isStepMode = response?.commandMode === "steps";
  const reasoningText = config.showReasoning ? response?.reasoning?.trim() : "";
  const requestStatus = error ? "error" : loading ? "waiting" : response ? "ready" : "idle";
  const requestStatusLabel = requestStatus === "waiting"
    ? t("aiAssist.statusWaiting", { seconds: elapsedSec })
    : requestStatus === "ready"
      ? t("aiAssist.statusReady", { seconds: elapsedSec })
      : requestStatus === "error"
        ? t("aiAssist.statusError")
        : t("aiAssist.statusIdle");
  const commandLabel = isStepMode
    ? t("aiAssist.step", { current: activeCommandIndex + 1, total: response?.commands.length ?? 1 })
    : t("aiAssist.option", { current: activeCommandIndex + 1, total: response?.commands.length ?? 1 });
  const primaryActionLabel = isStepMode
    ? (config.executionMode === "run" ? t("aiAssist.runStep") : t("aiAssist.insertStep"))
    : (config.executionMode === "run" ? t("aiAssist.runCommand") : t("aiAssist.insertCommand"));

  if (!open) return null;

  return (
    <aside className="term-ai-popover" role="complementary" aria-label={t("aiAssist.title")}>
      <header className="ai-head">
        <span className="ai-title">
          <span className="ai-glow" />
          <Sparkles size={13} />
          {t("aiAssist.title")}
        </span>
        <span className="ai-actions">
          <button
            className={cn("btn btn-icon btn-ghost", showHistory && "text-[var(--color-accent)]")}
            title={t("aiAssist.history")}
            onClick={() => setShowHistory((value) => !value)}
          >
            <History size={13} />
          </button>
          <button className="btn btn-icon btn-ghost" title={t("aiAssist.close")} onClick={onClose}>
            <X size={13} />
          </button>
        </span>
      </header>

      <div className="ai-profile-row">
        <select
          value={profileId}
          onChange={(event) => setProfileId(event.target.value)}
          className="ai-profile-select"
          disabled={config.profiles.length === 0}
        >
          {config.profiles.length === 0 ? (
            <option value="">{t("aiAssist.noProfile")}</option>
          ) : (
            config.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name || t("aiAgent.unnamedProfile")}
              </option>
            ))
          )}
        </select>
        <span className={cn("ai-state-pill", config.enabled ? "is-on" : "is-off")}>
          {config.enabled ? t("aiAssist.on") : t("aiAssist.off")}
        </span>
      </div>

      <div className="ai-request-status" data-state={requestStatus}>
        <span className="ai-request-dot" />
        <span>{requestStatusLabel}</span>
      </div>

      {showHistory ? (
        <div className="ai-history-panel">
          <div className="ai-history-head">
            <span>{t("aiAssist.history")}</span>
            <span>{t("aiAssist.historyCount", { n: historyItems.length })}</span>
          </div>
          {historyItems.length === 0 ? (
            <div className="ai-empty-state">{t("aiAssist.historyEmpty")}</div>
          ) : (
            <div className="ai-history-list">
              {historyItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="ai-history-item"
                  onClick={() => restoreHistoryItem(item)}
                >
                  <span className="ai-history-question">{item.question}</span>
                  <span className="ai-history-meta">
                    {t("aiAssist.historyMeta", {
                      n: item.response.commands.length,
                      time: new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    })}
                  </span>
                  <span className="ai-history-answer">{item.response.answer || item.response.rawText}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (<>
      {lastQuestion && (
        <div className="ai-question">
          <span className="who">{t("aiAssist.user")}</span>
          <p>{lastQuestion}</p>
        </div>
      )}

      {!config.enabled && (
        <div className="ai-empty-state">{t("aiAssist.disabled")}</div>
      )}
      {config.enabled && config.profiles.length === 0 && (
        <div className="ai-empty-state">{t("aiAssist.configureFirst")}</div>
      )}
      {selectedProfile && !selectedProfile.apiKeySet && (
        <div className="ai-empty-state">{t("aiAssist.missingKey")}</div>
      )}
      {error && <div className="ai-error">{error}</div>}

      {loading && (
        <div className="ai-loading">
          <Loader2 size={14} className="animate-spin" />
          {t("aiAssist.thinking")}
        </div>
      )}

      {response && !loading && (
        <div className="ai-suggestion">
          {reasoningText && (
            <div className="ai-reasoning">
              <button
                type="button"
                className="ai-reasoning-toggle"
                aria-expanded={showReasoning}
                onClick={() => setShowReasoning((value) => !value)}
              >
                <span>{t("aiAssist.reasoning")}</span>
                <span>{showReasoning ? t("aiAssist.collapse") : t("aiAssist.expand")}</span>
              </button>
              {showReasoning && (
                <pre className="ai-reasoning-body">{reasoningText}</pre>
              )}
            </div>
          )}
          {activeCommand ? (
            <>
              <div className="ai-suggestion-head">
                <span className="ai-step-tag">
                  {commandLabel}
                </span>
                <span className="ai-confidence">
                  <Check size={11} />
                  {confidenceLabel(activeCommand.confidence)}
                </span>
              </div>
              <div className="ai-cmd-block">
                <pre className="ai-cmd mono">{activeCommand.command}</pre>
                <button className="btn btn-icon btn-ghost ai-copy" title={t("aiAssist.copy")} onClick={() => void handleCopy(activeCommand.command)}>
                  <Copy size={12} />
                </button>
              </div>
              <p className="ai-explain">{activeCommand.description || response.answer}</p>
              <div className="ai-cta">
                <button className="btn btn-primary btn-sm" onClick={() => void handleRun(activeCommand)}>
                  <Check size={13} />
                  {primaryActionLabel}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setResponse(null)}>
                  <X size={13} />
                  {t("aiAssist.dismiss")}
                </button>
                <span className="ai-cta-spacer" />
                {response.commands.length > 1 && (
                  <>
                    <button
                      className="btn btn-icon btn-ghost"
                      disabled={activeCommandIndex === 0}
                      onClick={() => setActiveCommandIndex((index) => Math.max(0, index - 1))}
                      title={t("aiAssist.previous")}
                    >
                      <ChevronLeft size={13} />
                    </button>
                    <button
                      className="btn btn-icon btn-ghost"
                      disabled={activeCommandIndex >= response.commands.length - 1}
                      onClick={() => setActiveCommandIndex((index) => Math.min(response.commands.length - 1, index + 1))}
                      title={t("aiAssist.next")}
                    >
                      <ChevronRight size={13} />
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <p className="ai-explain">{response.answer || response.rawText}</p>
          )}
        </div>
      )}
      </>)}

      <form className="ai-input-bar" onSubmit={(event) => void handleSubmit(event)}>
        <span className="ai-input-icon">
          <Sparkles size={13} />
        </span>
        <input
          className="ai-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("aiAssist.placeholder")}
          disabled={loading || !config.enabled}
        />
        <button className="btn btn-icon btn-ghost" disabled={!canSend || loading} title={t("aiAssist.send")}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        </button>
      </form>
    </aside>
  );
}
