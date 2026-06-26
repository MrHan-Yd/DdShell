import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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

const DEFAULT_CONFIG: AiAgentConfig = {
  enabled: false,
  defaultProfileId: null,
  executionMode: "run",
  profiles: [],
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
  const [historyItems, setHistoryItems] = useState<AiHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    if (!selectedProfile.apiKeySet) {
      setError(t("aiAssist.missingKey"));
      return;
    }

    setLoading(true);
    setError("");
    setLastQuestion(trimmed);
    setActiveCommandIndex(0);
    setShowHistory(false);
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
      setResponse(result);
      setHistoryItems((current) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          question: trimmed,
          response: result,
          createdAt: Date.now(),
        },
        ...current,
      ].slice(0, 20));
      setQuestion("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const restoreHistoryItem = (item: AiHistoryItem) => {
    setLastQuestion(item.question);
    setResponse(item.response);
    setActiveCommandIndex(0);
    setShowHistory(false);
    setError("");
  };

  const handleRun = async (command: AiAgentCommand) => {
    const ok = await confirm({
      title: t("aiAssist.runConfirmTitle"),
      description: `${command.command}\n\n${command.description}`,
      confirmLabel: config.executionMode === "run" ? t("aiAssist.runCommand") : t("aiAssist.insertCommand"),
      cancelLabel: t("confirm.cancel"),
      confirmVariant: command.risk === "high" ? "danger" : "default",
    });
    if (!ok) return;
    onRunCommand(command.command, config.executionMode === "run");
  };

  const handleCopy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(t("aiAssist.copied"));
    } catch {
      toast.error(t("aiAssist.copyFailed"));
    }
  };

  if (!open) return null;

  return (
    <aside className="term-ai-popover" role="complementary" aria-label="AI command assistant">
      <header className="ai-head">
        <span className="ai-title">
          <span className="ai-glow" />
          <Sparkles size={13} />
          AI Assist
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
          <span className="who">You</span>
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
          {activeCommand ? (
            <>
              <div className="ai-suggestion-head">
                <span className="ai-step-tag">
                  {t("aiAssist.step", { current: activeCommandIndex + 1, total: response.commands.length })}
                </span>
                <span className="ai-confidence">
                  <Check size={11} />
                  {activeCommand.confidence}
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
                  {config.executionMode === "run" ? t("aiAssist.runCommand") : t("aiAssist.insertCommand")}
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
