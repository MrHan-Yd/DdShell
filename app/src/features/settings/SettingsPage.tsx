import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Sun, Moon, Monitor, Save, RotateCcw, AlertTriangle, Globe, FolderOpen, X, Check, Trash2, Plus, Github, Keyboard, Bot, Info, Palette, Search, MessageSquare, RefreshCw, BrainCircuit } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/themed/Button";
import { Input } from "@/components/ui/themed/Input";
import { Logo } from "@/components/Logo";
import { UpdaterProgress } from "@/components/UpdaterProgress";
import { DEFAULT_DANGEROUS_COMMANDS } from "@/lib/constants";
import { Select } from "@/components/ui/themed/Select";
import { SegmentedControl } from "@/components/ui/themed/SegmentedControl";
import { isUiTheme, useAppStore } from "@/stores/app";
import type { UiTheme } from "@/stores/app";
import { useCommandAssistStore } from "@/stores/commandAssist";
import { useTerminalStore } from "@/stores/terminal";
import { useSftpStore } from "@/stores/sftp";
import { useUpdaterStore } from "@/stores/updater";
import { t as translate, useT } from "@/lib/i18n";
import { getAppVersion } from "@/lib/constants";
import type { DictKey, Locale } from "@/lib/i18n";
import * as api from "@/lib/tauri";
import { isMacPlatform } from "@/lib/platform";
import { importTerminalBackgroundImagePath, migrateTerminalBackgroundImageSetting } from "@/lib/terminalBackground";
import { confirm, useConfirmStore } from "@/stores/confirm";
import { toast } from "@/stores/toast";
import type { AiAgentConfig, AiAgentExecutionMode, AiAgentModel, AiAgentProfile, AiAgentProtocol, AiAgentResponseMode, TerminalBgSource } from "@/types";
import { DEFAULT_COMMAND_ASSIST_MODE, type CommandAssistMode } from "@/features/terminal/CommandAssist";

const TABS = ["general", "transfer", "terminal", "commandAssist", "aiAgent", "shortcuts", "about"] as const;
type SettingsTab = (typeof TABS)[number];
const IS_MAC = isMacPlatform();
const GITHUB_REPO_URL = "https://github.com/MrHan-Yd/DdShell";
const GITHUB_ISSUES_URL = "https://github.com/MrHan-Yd/DdShell/issues";
const APP_RUNTIME = "Tauri 2 · React 19 · Rust";

interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  fontLigatures: boolean;
  foreground: string;
  cursor: string;
  cursorStyle: "block" | "underline" | "bar";
  cursorWidth: number;
  selectionBg: string;
  bgSource: TerminalBgSource;
  bgColor: string;
  bgImagePath: string;
  bgOpacity: number;
  bgBlur: number;
  encoding: string;
  setLocale: boolean;
  fileManagerDrawerEnabled: boolean;
  ansiColors: Record<string, string>;
  dangerousCmdProtection: boolean;
  disabledBuiltinCmds: string[];
  customDangerousCommands: string[];
}

const COLOR_THEMES: { id: string; label: string; colors: Record<string, string> }[] = [
  { id: "default", label: "默认", colors: { black: "#1B2130", red: "#EF4444", green: "#22C55E", yellow: "#F59E0B", blue: "#3B82F6", magenta: "#A855F7", cyan: "#06B6D4", white: "#E5E7EB" } },
  { id: "dracula", label: "Dracula", colors: { black: "#21222C", red: "#FF5555", green: "#50FA7B", yellow: "#F1FA8C", blue: "#BD93F9", magenta: "#FF79C6", cyan: "#8BE9FD", white: "#F8F8F2" } },
  { id: "nord", label: "Nord", colors: { black: "#3B4252", red: "#BF616A", green: "#A3BE8C", yellow: "#EBCB8B", blue: "#81A1C1", magenta: "#B48EAD", cyan: "#88C0D0", white: "#E5E9F0" } },
  { id: "solarized", label: "Solarized", colors: { black: "#073642", red: "#DC322F", green: "#859900", yellow: "#B58900", blue: "#268BD2", magenta: "#D33682", cyan: "#2AA198", white: "#EEE8D5" } },
  { id: "monokai", label: "Monokai", colors: { black: "#272822", red: "#F92672", green: "#A6E22E", yellow: "#F4BF75", blue: "#66D9EF", magenta: "#AE81FF", cyan: "#A1EFE4", white: "#F8F8F2" } },
  { id: "github", label: "GitHub", colors: { black: "#3E3E3E", red: "#970B16", green: "#07962A", yellow: "#F8EEC7", blue: "#003E8A", magenta: "#E94691", cyan: "#89D1EC", white: "#FFFFFF" } },
];

const DEFAULT_ANSI = COLOR_THEMES[0].colors;

// CommandAssist categories — referenced by both the main component (for load
// + Save) and the CommandAssistSettings child (for rendering).
const COMMAND_ASSIST_MAIN_IDS = ["git", "docker", "webServer"] as const;
const COMMAND_ASSIST_DEVTOOL_IDS = ["python", "node", "java", "maven", "gradle", "go", "jq", "kotlin", "php", "rust"] as const;
const COMMAND_ASSIST_ALL_IDS = [...COMMAND_ASSIST_MAIN_IDS, ...COMMAND_ASSIST_DEVTOOL_IDS] as const;

const DEFAULT_TERMINAL: TerminalSettings = {
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.4,
  fontLigatures: false,
  foreground: "#E5E7EB",
  cursor: "#3B82F6",
  cursorStyle: "bar",
  cursorWidth: 2,
  selectionBg: "rgba(59, 130, 246, 0.3)",
  bgSource: "color",
  bgColor: "#0F1115",
  bgImagePath: "",
  bgOpacity: 100,
  bgBlur: 0,
  encoding: "utf-8",
  setLocale: false,
  fileManagerDrawerEnabled: true,
  ansiColors: { ...DEFAULT_ANSI },
  dangerousCmdProtection: true,
  disabledBuiltinCmds: [],
  customDangerousCommands: [],
};

const DEFAULT_AI_AGENT_CONFIG: AiAgentConfig = {
  enabled: false,
  defaultProfileId: null,
  executionMode: "run",
  confirmBeforeExecute: true,
  showReasoning: false,
  timeoutSec: 60,
  profiles: [],
};

/** Compute relative luminance (WCAG formula) */
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Compute contrast ratio between two hex colors */
function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Find a foreground color with safe contrast against the bg */
function safeContrast(bg: string): string {
  const bgL = luminance(bg);
  // If bg is dark, use white-ish; if light, use dark
  return bgL > 0.4 ? "#1A1A1A" : "#F0F0F0";
}

function Section({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const sectionCls = "settings-group settings-section";
  return (
    <section className={`${sectionCls}${className ? ` ${className}` : ""}`}>
      <div className="settings-section__header">
        <h3 className="settings-group-title">{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="settings-section__content">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  children,
  indented,
  className,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  indented?: boolean;
  className?: string;
}) {
  const indentCls = indented ? " settings-row--indented" : "";
  const rowCls = `settings-row${indentCls}`;
  return (
    <div className={`${rowCls}${className ? ` ${className}` : ""}`}>
      <div className="settings-row-text settings-row__text">
        <span className="settings-row-label settings-row__label">{label}</span>
        {description && <span className="settings-row-help settings-row__description">{description}</span>}
      </div>
      <div className="settings-row-control settings-row__control">{children}</div>
    </div>
  );
}

function ShortcutsSettings({ t }: { t: ReturnType<typeof useT> }) {
  const mod = IS_MAC ? "Cmd" : "Ctrl";
  const opt = IS_MAC ? "Option" : "Alt";
  const groups = [
    {
      title: t("settings.shortcutScopeGlobal"),
      rows: [
        [`${mod}+T`, t("settings.shortcutGlobalTerminal")],
        [`${mod}+N`, t("settings.shortcutGlobalConnections")],
        [`${mod}+,`, t("settings.shortcutGlobalSettings")],
        [IS_MAC ? `${mod}+W` : `${mod}+Shift+W`, t("settings.shortcutGlobalCloseSession")],
      ],
    },
    {
      title: t("settings.shortcutScopeTerminal"),
      rows: [
        [`${mod}+L`, t("settings.shortcutTerminalClear")],
        ["Ctrl+U", t("settings.shortcutTerminalKillLine")],
        ["Ctrl+W", t("settings.shortcutTerminalKillWord")],
        [`${mod}+Shift+E`, t("settings.shortcutTerminalQuickEdit")],
        [`${opt}+Enter`, t("settings.shortcutTerminalInsertSelection")],
        [`${opt}+Shift+-`, t("settings.shortcutTerminalSplitHorizontal")],
        [`${opt}+Shift+|`, t("settings.shortcutTerminalSplitVertical")],
      ],
    },
    {
      title: t("settings.shortcutScopeSftp"),
      rows: [
        ["F5", t("settings.shortcutSftpRefresh")],
        ["F2", t("settings.shortcutSftpRename")],
        ["Delete", t("settings.shortcutSftpDelete")],
        [`${mod}+Shift+N`, t("settings.shortcutSftpNewFolder")],
      ],
    },
    {
      title: t("settings.shortcutScopePicker"),
      rows: [
        ["↑ / ↓", t("settings.shortcutPickerNavigate")],
        ["Enter", t("settings.shortcutPickerOpen")],
        ["← / Backspace", t("settings.shortcutPickerBack")],
        ["→", t("settings.shortcutPickerUndoBack")],
        [`${mod}+.`, t("settings.shortcutPickerHidden")],
        ["Esc", t("settings.shortcutPickerClose")],
      ],
    },
    {
      title: t("settings.shortcutScopeQuickEdit"),
      rows: [
        [`${mod}+S`, t("settings.shortcutQuickEditSave")],
        [`${mod}+F`, t("settings.shortcutQuickEditFind")],
        [`${mod}+${opt}+F`, t("settings.shortcutQuickEditReplace")],
      ],
    },
    {
      title: t("settings.shortcutScopeCommandAssist"),
      rows: [
        ["//", t("settings.shortcutAssistTrigger")],
        ["↑ / ↓", t("settings.shortcutAssistNavigate")],
        ["Tab / Enter", t("settings.shortcutAssistConfirm")],
        ["Esc", t("settings.shortcutAssistClose")],
      ],
    },
  ];

  return (
    <Section title={t("settings.shortcuts")}>
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.title} className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
              {group.title}
            </div>
            <div className="grid grid-cols-[150px_1fr] gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5 text-[var(--font-size-xs)] font-medium text-[var(--color-text-muted)]">
              <span>{t("settings.shortcutKeys")}</span>
              <span>{t("settings.shortcutEffect")}</span>
            </div>
            <div className="divide-y divide-[var(--color-border-subtle)]">
              {group.rows.map(([keys, effect]) => (
                <div key={`${group.title}-${keys}`} className="grid grid-cols-[150px_1fr] items-center gap-2 px-3 py-2 text-[var(--font-size-sm)]">
                  <kbd className="w-fit rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)] shadow-[var(--border-hairline-inner)]">
                    {keys}
                  </kbd>
                  <span className="text-[var(--color-text-secondary)]">{effect}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const DEFAULT_UI_FONT_FAMILY = "";
const DEFAULT_UI_FONT_SIZE = 14;

const SETTINGS_TAB_META: Array<{
  value: SettingsTab;
  icon: typeof Palette;
  labelKey: DictKey;
  descKey: DictKey;
}> = [
  { value: "general", icon: Palette, labelKey: "settings.tabGeneral", descKey: "settings.tabGeneralDesc" },
  { value: "transfer", icon: FolderOpen, labelKey: "settings.tabTransfer", descKey: "settings.tabTransferDesc" },
  { value: "terminal", icon: Monitor, labelKey: "settings.tabTerminal", descKey: "settings.tabTerminalDesc" },
  { value: "commandAssist", icon: Bot, labelKey: "settings.tabCommandAssist", descKey: "settings.tabCommandAssistDesc" },
  { value: "aiAgent", icon: BrainCircuit, labelKey: "settings.tabAiAgent", descKey: "settings.tabAiAgentDesc" },
  { value: "shortcuts", icon: Keyboard, labelKey: "settings.tabShortcuts", descKey: "settings.tabShortcutsDesc" },
  { value: "about", icon: Info, labelKey: "settings.tabAbout", descKey: "settings.tabAboutDesc" },
];

// ── Command Assist Settings ──

interface CommandAssistSettingsProps {
  t: ReturnType<typeof useT>;
  enabled: boolean;
  mode: CommandAssistMode;
  confirmKey: "tab" | "enter";
  position: string;
  enabledCategories: Record<string, boolean>;
  onToggleEnabled: (v: boolean) => void;
  onChangeMode: (v: CommandAssistMode) => void;
  onChangeConfirmKey: (v: "tab" | "enter") => void;
  onChangePosition: (v: string) => void;
  onChangeCategories: (cats: Record<string, boolean>) => void;
}

function CommandAssistSettings({
  t,
  enabled,
  mode,
  confirmKey,
  position,
  enabledCategories,
  onToggleEnabled,
  onChangeMode,
  onChangeConfirmKey,
  onChangePosition,
  onChangeCategories,
}: CommandAssistSettingsProps) {
  const [resetDone, setResetDone] = useState(false);

  const MAIN_CATEGORIES = [
    { id: "git", label: t("commandAssist.catGit"), desc: t("commandAssist.catGitDesc") },
    { id: "docker", label: t("commandAssist.catDocker"), desc: t("commandAssist.catDockerDesc") },
    { id: "webServer", label: t("commandAssist.catWebServer"), desc: t("commandAssist.catWebServerDesc") },
  ];

  const DEVTOOLS_SUB = [
    { id: "python", label: t("commandAssist.catPython"), desc: t("commandAssist.catPythonDesc") },
    { id: "node", label: t("commandAssist.catNode"), desc: t("commandAssist.catNodeDesc") },
    { id: "java", label: t("commandAssist.catJava"), desc: t("commandAssist.catJavaDesc") },
    { id: "maven", label: t("commandAssist.catMaven"), desc: t("commandAssist.catMavenDesc") },
    { id: "gradle", label: t("commandAssist.catGradle"), desc: t("commandAssist.catGradleDesc") },
    { id: "go", label: t("commandAssist.catGo"), desc: t("commandAssist.catGoDesc") },
    { id: "jq", label: t("commandAssist.catJq"), desc: t("commandAssist.catJqDesc") },
    { id: "kotlin", label: t("commandAssist.catKotlin"), desc: t("commandAssist.catKotlinDesc") },
    { id: "php", label: t("commandAssist.catPhp"), desc: t("commandAssist.catPhpDesc") },
    { id: "rust", label: t("commandAssist.catRust"), desc: t("commandAssist.catRustDesc") },
  ];

  const handleConfirmKeyChange = async (newVal: string) => {
    if (newVal !== "tab" && newVal !== "enter") return;
    if (newVal === "enter") {
      const ok = await confirm({
        title: t("commandAssist.confirmKey"),
        description: t("commandAssist.enterWarning"),
        confirmLabel: t("confirm.ok"),
        cancelLabel: t("confirm.cancel"),
        confirmVariant: "default",
      });
      if (!ok) return;
    }
    onChangeConfirmKey(newVal);
  };

  const handleToggleCategory = (catId: string, newVal: boolean) => {
    onChangeCategories({ ...enabledCategories, [catId]: newVal });
  };

  // CommandAssist weight reset 是命令式动作（不进草稿，立即执行）
  const handleResetWeights = async () => {
    const ok = await confirm({
      title: t("commandAssist.resetWeights"),
      description: t("commandAssist.resetWeightsConfirm"),
      confirmLabel: t("confirm.ok"),
      cancelLabel: t("confirm.cancel"),
    });
    if (!ok) return;
    try {
      await api.commandAssistWeightReset();
      setResetDone(true);
      toast.success(t("commandAssist.resetDone"));
      setTimeout(() => setResetDone(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <>
      <Section title={t("commandAssist.triggerSection")}>
        <SettingRow
          label={t("commandAssist.enabled")}
          description={t("commandAssist.enabledDesc")}
        >
          <button
            onClick={() => onToggleEnabled(!enabled)}
            data-state={enabled ? "on" : "off"}
            className="toggle-switch"
          >
            <span className="toggle-thumb" />
          </button>
        </SettingRow>

        <SettingRow
          label={t("commandAssist.mode")}
          description={t("commandAssist.modeDesc")}
        >
          <SegmentedControl
            value={mode}
            onChange={(v) => {
              if (v === "slash" || v === "listview") onChangeMode(v);
            }}
            options={[
              {
                value: "slash",
                label: (
                  <span
                    className="inline-flex items-center gap-1"
                    title={t("commandAssist.quickInvokeHint")}
                  >
                    {t("commandAssist.modeSlash")}
                    <Info
                      size={12}
                      aria-label={t("commandAssist.quickInvokeHint")}
                      className="text-[var(--color-text-muted)]"
                    />
                  </span>
                ),
              },
              { value: "listview", label: t("commandAssist.modeListView") },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={t("commandAssist.confirmKey")}
          description={t("commandAssist.confirmKeyDesc")}
        >
          <SegmentedControl
            value={confirmKey}
            onChange={handleConfirmKeyChange}
            options={[
              { value: "tab", label: t("commandAssist.tab") },
              { value: "enter", label: t("commandAssist.enter") },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={t("commandAssist.position")}
          description={t("commandAssist.positionDesc")}
        >
          <SegmentedControl
            value={position}
            onChange={onChangePosition}
            options={[
              { value: "bottom-left", label: t("commandAssist.posBottomLeft") },
              { value: "bottom-right", label: t("commandAssist.posBottomRight") },
              { value: "follow-cursor", label: t("commandAssist.posFollowCursor") },
            ]}
          />
        </SettingRow>

        <div className="flex items-center justify-between py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[var(--font-size-sm)]">{t("commandAssist.resetWeights")}</p>
            <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {t("commandAssist.resetWeightsDesc")}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleResetWeights}
          >
            {resetDone ? <Check size={12} /> : <RotateCcw size={12} />}
            {resetDone ? t("settings.done") : t("settings.reset")}
          </Button>
        </div>
      </Section>

      {enabled && (
        <Section title={t("commandAssist.appCategories")}>
          <div className="pb-2">
            <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {t("commandAssist.appCategoriesDesc")}
            </p>
          </div>
          {MAIN_CATEGORIES.map((cat) => (
            <SettingRow
              key={cat.id}
              label={cat.label}
              description={cat.desc}
            >
              <button
                onClick={() => handleToggleCategory(cat.id, !enabledCategories[cat.id])}
                data-state={enabledCategories[cat.id] !== false ? "on" : "off"}
                className="toggle-switch"
              >
                <span className="toggle-thumb" />
              </button>
            </SettingRow>
          ))}

          <SettingRow
            label={t("commandAssist.catDevTools")}
            description={t("commandAssist.catDevToolsDesc")}
          >
            <button
              onClick={() => {
                const subIds = DEVTOOLS_SUB.map((s) => s.id);
                const allOn = subIds.every((id) => enabledCategories[id] !== false);
                const updated = { ...enabledCategories };
                for (const id of subIds) updated[id] = !allOn;
                onChangeCategories(updated);
              }}
              data-state={DEVTOOLS_SUB.some((s) => enabledCategories[s.id] !== false) ? "on" : "off"}
              className="toggle-switch"
            >
              <span className="toggle-thumb" />
            </button>
          </SettingRow>
          <div className="flex flex-wrap gap-2 pl-4 py-1">
            {DEVTOOLS_SUB.map((sub) => {
              const active = enabledCategories[sub.id] !== false;
              return (
                <button
                  key={sub.id}
                  onClick={() => handleToggleCategory(sub.id, !active)}
                  className={`lang-chip${active ? " lang-chip--active" : ""}`}
                >
                  {sub.label}
                </button>
              );
            })}
          </div>

        </Section>
      )}
    </>
  );
}

interface AiAgentSettingsProps {
  t: ReturnType<typeof useT>;
  config: AiAgentConfig;
  keyDrafts: Record<string, string>;
  clearedKeys: Record<string, boolean>;
  onChange: (config: AiAgentConfig) => void;
  onChangeKeyDraft: (profileId: string, value: string) => void;
  onClearKey: (profileId: string) => void;
}

const AI_PROTOCOL_OPTIONS: Array<{ value: AiAgentProtocol; labelKey: DictKey }> = [
  { value: "openaiChat", labelKey: "aiAgent.protocolOpenaiChat" },
  { value: "openaiResponses", labelKey: "aiAgent.protocolOpenaiResponses" },
  { value: "claudeMessages", labelKey: "aiAgent.protocolClaude" },
  { value: "geminiGenerateContent", labelKey: "aiAgent.protocolGemini" },
];

const AI_RESPONSE_MODE_OPTIONS: Array<{ value: AiAgentResponseMode; labelKey: DictKey }> = [
  { value: "auto", labelKey: "aiAgent.responseAuto" },
  { value: "stream", labelKey: "aiAgent.responseStream" },
  { value: "nonStream", labelKey: "aiAgent.responseNonStream" },
];

function boundedNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function defaultAiModel(): AiAgentModel {
  return {
    id: crypto.randomUUID(),
    name: "GPT 4.1",
    model: "gpt-4.1",
    contextWindowTokens: 128000,
    temperature: 0.2,
    maxTokens: 1200,
    responseMode: "nonStream",
  };
}

function defaultAiProfile(): AiAgentProfile {
  const model = defaultAiModel();
  return {
    id: crypto.randomUUID(),
    name: "OpenAI",
    protocol: "openaiChat",
    baseUrl: "https://api.openai.com/v1",
    defaultModelId: model.id,
    models: [model],
    apiKeySet: false,
  };
}

function normalizeAiProfileDraft(profile: AiAgentProfile): AiAgentProfile {
  const legacyModel = profile.model?.trim();
  const models = profile.models?.length
    ? profile.models
    : legacyModel
      ? [{
        id: "default",
        name: legacyModel,
        model: legacyModel,
        contextWindowTokens: profile.contextWindowTokens,
        temperature: profile.temperature,
        maxTokens: profile.maxTokens,
        responseMode: profile.responseMode || "nonStream",
      }]
      : [];
  const defaultModelId = models.some((model) => model.id === profile.defaultModelId)
    ? profile.defaultModelId
    : models[0]?.id ?? null;
  return {
    ...profile,
    defaultModelId,
    models,
  };
}

function AiAgentSettings({
  t,
  config,
  keyDrafts,
  clearedKeys,
  onChange,
  onChangeKeyDraft,
  onClearKey,
}: AiAgentSettingsProps) {
  const profiles = config.profiles.map(normalizeAiProfileDraft);

  const updateProfile = (profileId: string, patch: Partial<AiAgentProfile>) => {
    onChange({
      ...config,
      profiles: profiles.map((profile) => (
        profile.id === profileId ? normalizeAiProfileDraft({ ...profile, ...patch }) : profile
      )),
    });
  };

  const updateModel = (profileId: string, modelId: string, patch: Partial<AiAgentModel>) => {
    onChange({
      ...config,
      profiles: profiles.map((profile) => (
        profile.id === profileId
          ? {
            ...profile,
            models: profile.models.map((model) => (
              model.id === modelId ? { ...model, ...patch } : model
            )),
          }
          : profile
      )),
    });
  };

  const addModel = (profileId: string) => {
    const model = defaultAiModel();
    onChange({
      ...config,
      profiles: profiles.map((profile) => (
        profile.id === profileId
          ? {
            ...profile,
            defaultModelId: profile.defaultModelId || model.id,
            models: [...profile.models, model],
          }
          : profile
      )),
    });
  };

  const removeModel = (profileId: string, modelId: string) => {
    onChange({
      ...config,
      profiles: profiles.map((profile) => {
        if (profile.id !== profileId) return profile;
        const models = profile.models.filter((model) => model.id !== modelId);
        const defaultModelId = profile.defaultModelId === modelId
          ? models[0]?.id ?? null
          : profile.defaultModelId ?? null;
        return { ...profile, models, defaultModelId };
      }),
    });
  };

  const setDefaultModel = (profileId: string, modelId: string) => {
    updateProfile(profileId, { defaultModelId: modelId });
  };

  const addProfile = () => {
    const profile = defaultAiProfile();
    onChange({
      ...config,
      defaultProfileId: config.defaultProfileId || profile.id,
      profiles: [...profiles, profile],
    });
  };

  const removeProfile = (profileId: string) => {
    const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
    const defaultProfileId = config.defaultProfileId === profileId
      ? nextProfiles[0]?.id ?? null
      : config.defaultProfileId ?? null;
    onChange({ ...config, profiles: nextProfiles, defaultProfileId });
  };

  const setDefaultProfile = (profileId: string) => {
    onChange({ ...config, defaultProfileId: profileId });
  };

  return (
    <>
      <Section title={t("aiAgent.general")} description={t("aiAgent.generalDesc")}>
        <SettingRow label={t("aiAgent.enabled")} description={t("aiAgent.enabledDesc")}>
          <button
            onClick={() => onChange({ ...config, enabled: !config.enabled })}
            data-state={config.enabled ? "on" : "off"}
            className="toggle-switch"
          >
            <span className="toggle-thumb" />
          </button>
        </SettingRow>

        <SettingRow label={t("aiAgent.executionMode")} description={t("aiAgent.executionModeDesc")}>
          <SegmentedControl
            value={config.executionMode}
            onChange={(value) => {
              if (value === "run" || value === "insert") {
                onChange({ ...config, executionMode: value as AiAgentExecutionMode });
              }
            }}
            options={[
              { value: "run", label: t("aiAgent.executionRun") },
              { value: "insert", label: t("aiAgent.executionInsert") },
            ]}
          />
        </SettingRow>

        <SettingRow label={t("aiAgent.confirmBeforeExecute")} description={t("aiAgent.confirmBeforeExecuteDesc")}>
          <button
            onClick={() => onChange({ ...config, confirmBeforeExecute: !config.confirmBeforeExecute })}
            data-state={config.confirmBeforeExecute ? "on" : "off"}
            className="toggle-switch"
          >
            <span className="toggle-thumb" />
          </button>
        </SettingRow>

        <SettingRow label={t("aiAgent.showReasoning")} description={t("aiAgent.showReasoningDesc")}>
          <button
            onClick={() => onChange({ ...config, showReasoning: !config.showReasoning })}
            data-state={config.showReasoning ? "on" : "off"}
            className="toggle-switch"
          >
            <span className="toggle-thumb" />
          </button>
        </SettingRow>

        <SettingRow label={t("aiAgent.timeout")} description={t("aiAgent.timeoutDesc")}>
          <Input
            type="number"
            min={5}
            max={300}
            value={String(config.timeoutSec ?? 60)}
            onChange={(event) => onChange({ ...config, timeoutSec: boundedNumber(event.target.value, 60, 5, 300) })}
          />
        </SettingRow>

        <SettingRow label={t("aiAgent.defaultProfile")} description={t("aiAgent.defaultProfileDesc")}>
          <Select
            value={config.defaultProfileId || ""}
            onChange={(value) => onChange({ ...config, defaultProfileId: value || null })}
            options={[
              { value: "", label: t("aiAgent.noProfile") },
              ...profiles.map((profile) => ({ value: profile.id, label: profile.name || t("aiAgent.unnamedProfile") })),
            ]}
          />
        </SettingRow>
      </Section>

      <Section title={t("aiAgent.profiles")} description={t("aiAgent.profilesDesc")}>
        <div className="flex justify-end pb-3">
          <Button size="sm" variant="secondary" onClick={addProfile}>
            <Plus size={14} />
            {t("aiAgent.addProfile")}
          </Button>
        </div>

        {profiles.length === 0 ? (
          <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-4 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("aiAgent.emptyProfiles")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {profiles.map((profile) => {
              const keyCleared = Boolean(clearedKeys[profile.id]);
              const hasKey = profile.apiKeySet && !keyCleared;
              return (
                <div key={profile.id} className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <Input
                      value={profile.name}
                      onChange={(event) => updateProfile(profile.id, { name: event.target.value })}
                      placeholder={t("aiAgent.profileName")}
                    />
                    <Button
                      size="sm"
                      variant={config.defaultProfileId === profile.id ? "default" : "secondary"}
                      onClick={() => setDefaultProfile(profile.id)}
                    >
                      <Check size={13} />
                      {config.defaultProfileId === profile.id ? t("aiAgent.default") : t("aiAgent.setDefault")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeProfile(profile.id)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <SettingRow label={t("aiAgent.protocol")} className="settings-row--compact">
                      <Select
                        value={profile.protocol}
                        onChange={(value) => updateProfile(profile.id, { protocol: value as AiAgentProtocol })}
                        options={AI_PROTOCOL_OPTIONS.map((option) => ({
                          value: option.value,
                          label: t(option.labelKey),
                        }))}
                      />
                    </SettingRow>
                    <SettingRow label={t("aiAgent.baseUrl")} className="settings-row--compact">
                      <Input
                        value={profile.baseUrl}
                        onChange={(event) => updateProfile(profile.id, { baseUrl: event.target.value })}
                        placeholder="https://api.openai.com/v1"
                      />
                    </SettingRow>
                    <SettingRow label={t("aiAgent.apiKey")} description={hasKey ? t("aiAgent.apiKeySaved") : t("aiAgent.apiKeyMissing")} className="settings-row--compact">
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          value={keyDrafts[profile.id] ?? ""}
                          onChange={(event) => onChangeKeyDraft(profile.id, event.target.value)}
                          placeholder={hasKey ? t("aiAgent.keepExistingKey") : t("aiAgent.enterApiKey")}
                        />
                        {hasKey && (
                          <Button size="sm" variant="secondary" onClick={() => onClearKey(profile.id)}>
                            {t("settings.clear")}
                          </Button>
                        )}
                      </div>
                    </SettingRow>
                    <SettingRow label={t("aiAgent.defaultModel")} description={t("aiAgent.defaultModelDesc")} className="settings-row--compact">
                      <Select
                        value={profile.defaultModelId || ""}
                        onChange={(value) => updateProfile(profile.id, { defaultModelId: value || null })}
                        options={[
                          { value: "", label: t("aiAgent.noModel") },
                          ...profile.models.map((model) => ({
                            value: model.id,
                            label: model.name || model.model || t("aiAgent.unnamedModel"),
                          })),
                        ]}
                      />
                    </SettingRow>
                  </div>

                  <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">{t("aiAgent.models")}</div>
                        <div className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">{t("aiAgent.modelsDesc")}</div>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => addModel(profile.id)}>
                        <Plus size={14} />
                        {t("aiAgent.addModel")}
                      </Button>
                    </div>

                    {profile.models.length === 0 ? (
                      <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-3 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
                        {t("aiAgent.emptyModels")}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {profile.models.map((model) => (
                          <div key={model.id} className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3">
                            <div className="mb-3 flex items-center gap-2">
                              <Input
                                value={model.name}
                                onChange={(event) => updateModel(profile.id, model.id, { name: event.target.value })}
                                placeholder={t("aiAgent.modelName")}
                              />
                              <Button
                                size="sm"
                                variant={profile.defaultModelId === model.id ? "default" : "secondary"}
                                onClick={() => setDefaultModel(profile.id, model.id)}
                              >
                                <Check size={13} />
                                {profile.defaultModelId === model.id ? t("aiAgent.default") : t("aiAgent.setDefaultModel")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => removeModel(profile.id, model.id)}>
                                <Trash2 size={13} />
                              </Button>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <SettingRow label={t("aiAgent.modelId")} className="settings-row--compact">
                                <Input
                                  value={model.model}
                                  onChange={(event) => updateModel(profile.id, model.id, { model: event.target.value })}
                                  placeholder="gpt-4.1"
                                />
                              </SettingRow>
                              <SettingRow label={t("aiAgent.contextWindow")} description={t("aiAgent.contextWindowDesc")} className="settings-row--compact">
                                <Input
                                  type="number"
                                  min={1000}
                                  max={10000000}
                                  step={1000}
                                  value={String(model.contextWindowTokens ?? 128000)}
                                  onChange={(event) => updateModel(profile.id, model.id, { contextWindowTokens: boundedNumber(event.target.value, 128000, 1000, 10000000) })}
                                />
                              </SettingRow>
                              <SettingRow label={t("aiAgent.responseMode")} description={t("aiAgent.responseModeDesc")} className="settings-row--compact">
                                <SegmentedControl
                                  value={model.responseMode || "nonStream"}
                                  onChange={(value) => {
                                    if (value === "auto" || value === "stream" || value === "nonStream") {
                                      updateModel(profile.id, model.id, { responseMode: value as AiAgentResponseMode });
                                    }
                                  }}
                                  options={AI_RESPONSE_MODE_OPTIONS.map((option) => ({
                                    value: option.value,
                                    label: t(option.labelKey),
                                  }))}
                                />
                              </SettingRow>
                              <SettingRow label={t("aiAgent.temperature")} description={t("aiAgent.temperatureDesc")} className="settings-row--compact">
                                <Input
                                  type="number"
                                  min={0}
                                  max={2}
                                  step={0.1}
                                  value={String(model.temperature ?? 0.2)}
                                  onChange={(event) => updateModel(profile.id, model.id, { temperature: boundedNumber(event.target.value, 0.2, 0, 2) })}
                                />
                              </SettingRow>
                              <SettingRow label={t("aiAgent.maxTokens")} description={t("aiAgent.maxTokensDesc")} className="settings-row--compact">
                                <Input
                                  type="number"
                                  min={128}
                                  max={8000}
                                  step={128}
                                  value={String(model.maxTokens ?? 1200)}
                                  onChange={(event) => updateModel(profile.id, model.id, { maxTokens: boundedNumber(event.target.value, 1200, 128, 8000) })}
                                />
                              </SettingRow>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}

export function SettingsPage() {
  const committedTheme = useAppStore((s) => s.theme);
  const committedUiTheme = useAppStore((s) => s.uiTheme);
  const setStoreTheme = useAppStore((s) => s.setTheme);
  const setStoreUiTheme = useAppStore((s) => s.setUiTheme);
  const setStoreLocale = useAppStore((s) => s.setLocale);
  const setSettingsDirty = useAppStore((s) => s.setSettingsDirty);
  const connectedCount = useTerminalStore((s) => s.tabs.filter((tab) => tab.state === "connected").length);
  const activeTransfers = useSftpStore((s) => s.transfers.filter((transfer) => transfer.state === "running" || transfer.state === "queued").length);
  const updateStatus = useUpdaterStore((s) => s.status);
  const updateLatestVersion = useUpdaterStore((s) => s.latestVersion);
  const updateProgress = useUpdaterStore((s) => s.progress);
  const updateSlowNetwork = useUpdaterStore((s) => s.slowNetwork);
  const loadUpdateCurrentVersion = useUpdaterStore((s) => s.loadCurrentVersion);
  const checkForUpdate = useUpdaterStore((s) => s.checkForUpdate);
  const downloadAndInstallUpdate = useUpdaterStore((s) => s.downloadAndInstall);
  const restartUpdatedApp = useUpdaterStore((s) => s.restartApp);
  const openUpdateFallback = useUpdaterStore((s) => s.openFallback);
  const t = useT();

  // Draft state — visual changes (theme/uiTheme/locale) only commit to global
  // store on Save success, so the page stays visually stable while editing.
  const [theme, setTheme] = useState<"dark" | "light" | "system">(() => useAppStore.getState().theme);
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => useAppStore.getState().uiTheme);
  const [locale, setLocale] = useState<Locale>(() => useAppStore.getState().locale);

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");
  const [terminal, setTerminal] = useState<TerminalSettings>(DEFAULT_TERMINAL);
  const [uiFontFamily, setUiFontFamily] = useState(DEFAULT_UI_FONT_FAMILY);
  const [uiFontSize, setUiFontSize] = useState(DEFAULT_UI_FONT_SIZE);
  const [confirmDanger, setConfirmDanger] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [chunkSize, setChunkSize] = useState("256");
  const [maxConcurrent, setMaxConcurrent] = useState("3");
  const [transferTimeout, setTransferTimeout] = useState("300");
  const [retryCount, setRetryCount] = useState("3");
  const [downloadPath, setDownloadPath] = useState("");
  const [transferNotify, setTransferNotify] = useState(true);
  const [predictiveEchoEnabled, setPredictiveEchoEnabled] = useState(true);
  const [predictiveEchoShowPasswordInput, setPredictiveEchoShowPasswordInput] = useState(true);
  // CommandAssist settings are drafted here and committed together on Save.
  const [caEnabled, setCaEnabled] = useState(false);
  const [caMode, setCaMode] = useState<CommandAssistMode>(DEFAULT_COMMAND_ASSIST_MODE);
  const [caConfirmKey, setCaConfirmKey] = useState<"tab" | "enter">("tab");
  const [caPosition, setCaPosition] = useState("bottom-left");
  const [caEnabledCategories, setCaEnabledCategories] = useState<Record<string, boolean>>({});
  const [aiAgentConfig, setAiAgentConfig] = useState<AiAgentConfig>(DEFAULT_AI_AGENT_CONFIG);
  const [aiAgentKeyDrafts, setAiAgentKeyDrafts] = useState<Record<string, string>>({});
  const [aiAgentClearedKeys, setAiAgentClearedKeys] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [clearHistoryStatus, setClearHistoryStatus] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [appPlatform, setAppPlatform] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Snapshot of last-saved values for dirty detection. JSON-stringify of the
  // full draft is good enough at this volume (~19 fields, low render frequency)
  // and side-steps deep-equal helpers.
  const lastSavedRef = useRef<string | null>(null);
  const snapshotValue = {
    theme, uiTheme, locale, terminal, uiFontFamily, uiFontSize,
    confirmDanger, sessionTimeout, chunkSize, maxConcurrent, transferTimeout,
    retryCount, downloadPath, transferNotify, predictiveEchoEnabled, predictiveEchoShowPasswordInput,
    caEnabled, caMode, caConfirmKey, caPosition, caEnabledCategories,
    aiAgentConfig, aiAgentKeyDrafts, aiAgentClearedKeys,
  };
  const draftSnapshot = JSON.stringify(snapshotValue);

  useEffect(() => {
    if (!loaded) return;
    // First render after load: seed the baseline snapshot, dirty stays false.
    if (lastSavedRef.current === null) {
      lastSavedRef.current = draftSnapshot;
      return;
    }
    setSettingsDirty(draftSnapshot !== lastSavedRef.current);
  }, [draftSnapshot, loaded, setSettingsDirty]);

  // Clear dirty flag when leaving Settings page.
  useEffect(() => {
    return () => setSettingsDirty(false);
  }, [setSettingsDirty]);

  useEffect(() => {
    void loadUpdateCurrentVersion();
    getAppVersion().then(setAppVersion);
    api.appPlatformInfo().then((info) => setAppPlatform(info.label)).catch(() => setAppPlatform("Unknown"));
  }, [loadUpdateCurrentVersion]);

  const maybeShowPredictiveEchoGuidance = useCallback(() => {
    try {
      const shown = localStorage.getItem("terminal.predictiveEcho.guidanceShown");
      if (shown !== "true") {
        toast.info(translate("settings.predictiveEchoGuidance", useAppStore.getState().locale));
        localStorage.setItem("terminal.predictiveEcho.guidanceShown", "true");
      }
    } catch {
      // localStorage unavailable — skip silently; will retry next time
    }
  }, []);

  // Load settings from backend on mount
  useEffect(() => {
    (async () => {
      try {
        const [
          savedTheme,
          savedFontFamily,
          savedFontSize,
          savedFontWeight,
          savedLineHeight,
          savedFontLigatures,
          savedForeground,
          savedCursor,
          savedCursorStyle,
          savedCursorWidth,
          savedAnsiColors,
          savedSelectionBg,
          savedConfirmDanger,
          savedKeepAlive,
          savedChunkSize,
          savedMaxConcurrent,
          savedTransferTimeout,
          savedRetryCount,
          savedDownloadPath,
          savedTransferNotify,
          savedBgSource,
          savedBgColor,
          savedBgImagePath,
          savedBgOpacity,
          savedBgBlur,
          savedLocale,
          savedUiTheme,
          savedUiFontFamily,
          savedUiFontSize,
          savedEncoding,
          savedSetLocale,
          savedFileManagerDrawerEnabled,
          savedDangerousCmdProtection,
          savedDisabledBuiltinCmds,
          savedCustomDangerousCommands,
          savedPredictiveEchoEnabled,
          savedPredictiveEchoShowPasswordInput,
        ] = await Promise.all([
          api.settingGet("theme"),
          api.settingGet("terminal.fontFamily"),
          api.settingGet("terminal.fontSize"),
          api.settingGet("terminal.fontWeight"),
          api.settingGet("terminal.lineHeight"),
          api.settingGet("terminal.fontLigatures"),
          api.settingGet("terminal.foreground"),
          api.settingGet("terminal.cursor"),
          api.settingGet("terminal.cursorStyle"),
          api.settingGet("terminal.cursorWidth"),
          api.settingGet("terminal.ansiColors"),
          api.settingGet("terminal.selectionBg"),
          api.settingGet("confirmDangerousActions"),
          api.settingGet("session.keepAlive"),
          api.settingGet("transfer.chunkSize"),
          api.settingGet("transfer.maxConcurrent"),
          api.settingGet("transfer.timeout"),
          api.settingGet("transfer.retryCount"),
          api.settingGet("transfer.downloadPath"),
          api.settingGet("transfer.notify"),
          api.settingGet("terminal.bgSource"),
          api.settingGet("terminal.bgColor"),
          api.settingGet("terminal.bgImagePath"),
          api.settingGet("terminal.bgOpacity"),
          api.settingGet("terminal.bgBlur"),
          api.settingGet("locale"),
          api.settingGet("ui.theme"),
          api.settingGet("ui.fontFamily"),
          api.settingGet("ui.fontSize"),
          api.settingGet("terminal.encoding"),
          api.settingGet("terminal.setLocale"),
          api.settingGet("terminal.fileManagerDrawer.enabled"),
          api.settingGet("terminal.dangerousCmdProtection"),
          api.settingGet("terminal.disabledBuiltinCmds"),
          api.settingGet("terminal.customDangerousCommands"),
          api.settingGet("terminal.predictiveEcho.enabled"),
          api.settingGet("terminal.predictiveEcho.showPasswordInput"),
        ]);

        if (savedTheme === "dark" || savedTheme === "light" || savedTheme === "system") {
          setTheme(savedTheme);
        }
        if (isUiTheme(savedUiTheme)) setUiTheme(savedUiTheme);
        if (savedLocale === "zh" || savedLocale === "en") setLocale(savedLocale as Locale);
        const migratedBgImagePath = await migrateTerminalBackgroundImageSetting(savedBgImagePath);

        setTerminal({
          fontFamily: savedFontFamily || DEFAULT_TERMINAL.fontFamily,
          fontSize: savedFontSize ? parseInt(savedFontSize) : DEFAULT_TERMINAL.fontSize,
          fontWeight: savedFontWeight ? parseInt(savedFontWeight) : DEFAULT_TERMINAL.fontWeight,
          lineHeight: savedLineHeight ? parseFloat(savedLineHeight) : DEFAULT_TERMINAL.lineHeight,
          fontLigatures: savedFontLigatures === "true",
          foreground: savedForeground || DEFAULT_TERMINAL.foreground,
          cursor: savedCursor || DEFAULT_TERMINAL.cursor,
          cursorStyle: (["block", "underline", "bar"].includes(savedCursorStyle || "") ? savedCursorStyle : DEFAULT_TERMINAL.cursorStyle) as "block" | "underline" | "bar",
          cursorWidth: savedCursorWidth ? parseInt(savedCursorWidth) : DEFAULT_TERMINAL.cursorWidth,
          selectionBg: savedSelectionBg || DEFAULT_TERMINAL.selectionBg,
          bgSource: (savedBgSource as TerminalBgSource) || DEFAULT_TERMINAL.bgSource,
          bgColor: savedBgColor || DEFAULT_TERMINAL.bgColor,
          bgImagePath: migratedBgImagePath || DEFAULT_TERMINAL.bgImagePath,
          bgOpacity: savedBgOpacity ? parseInt(savedBgOpacity) : DEFAULT_TERMINAL.bgOpacity,
          bgBlur: savedBgBlur ? parseInt(savedBgBlur) : DEFAULT_TERMINAL.bgBlur,
          encoding: savedEncoding || DEFAULT_TERMINAL.encoding,
          setLocale: savedSetLocale === "true",
          fileManagerDrawerEnabled: savedFileManagerDrawerEnabled !== "false",
          ansiColors: (() => { try { const p = JSON.parse(savedAnsiColors || ""); return { ...DEFAULT_ANSI, ...p }; } catch { return { ...DEFAULT_ANSI }; } })(),
          dangerousCmdProtection: savedDangerousCmdProtection !== "false",
          disabledBuiltinCmds: (() => { try { const arr = JSON.parse(savedDisabledBuiltinCmds || ""); return Array.isArray(arr) ? arr : []; } catch { return []; } })(),
          customDangerousCommands: (() => { try { const arr = JSON.parse(savedCustomDangerousCommands || ""); return Array.isArray(arr) ? arr : []; } catch { return []; } })(),
        });

        setConfirmDanger(savedConfirmDanger !== "false");
        setSessionTimeout(savedKeepAlive || "30");
        setChunkSize(savedChunkSize || "256");
        setMaxConcurrent(savedMaxConcurrent || "3");
        setTransferTimeout(savedTransferTimeout || "300");
        setRetryCount(savedRetryCount || "3");
        setDownloadPath(savedDownloadPath || "");
        setTransferNotify(savedTransferNotify !== "false");
        const predictiveEchoEnabledByDefault = savedPredictiveEchoEnabled !== "false";
        setPredictiveEchoEnabled(predictiveEchoEnabledByDefault);
        setPredictiveEchoShowPasswordInput(savedPredictiveEchoShowPasswordInput !== "false");
        if (predictiveEchoEnabledByDefault && savedPredictiveEchoEnabled == null) {
          maybeShowPredictiveEchoGuidance();
        }

        setUiFontFamily(savedUiFontFamily || DEFAULT_UI_FONT_FAMILY);
        setUiFontSize(savedUiFontSize ? parseInt(savedUiFontSize) : DEFAULT_UI_FONT_SIZE);

        // CommandAssist settings are drafted here and committed together on Save.
        const [savedCaEnabled, savedCaMode, savedCaConfirmKey, savedCaPosition, savedCaCats] = await Promise.all([
          api.settingGet("commandAssist.enabled"),
          api.settingGet("commandAssist.mode"),
          api.settingGet("commandAssist.confirmKey"),
          api.settingGet("commandAssist.position"),
          api.settingGet("commandAssist.enabledAppCategories"),
        ]);
        setCaEnabled(savedCaEnabled === "true");
        setCaMode(savedCaMode === "slash" || savedCaMode === "listview" ? savedCaMode : DEFAULT_COMMAND_ASSIST_MODE);
        if (savedCaConfirmKey === "tab" || savedCaConfirmKey === "enter") setCaConfirmKey(savedCaConfirmKey);
        if (savedCaPosition) setCaPosition(savedCaPosition);
        const cats: Record<string, boolean> = {};
        if (!savedCaCats) {
          for (const id of COMMAND_ASSIST_ALL_IDS) cats[id] = true;
        } else {
          let parsed: string[] = [];
          try { parsed = JSON.parse(savedCaCats); } catch { /* ignore */ }
          if (parsed.includes("devTools")) {
            parsed = parsed.filter((c) => c !== "devTools").concat([...COMMAND_ASSIST_DEVTOOL_IDS]);
          }
          for (const id of COMMAND_ASSIST_ALL_IDS) cats[id] = parsed.includes(id);
        }
        setCaEnabledCategories(cats);

        try {
          const savedAiAgentConfig = await api.aiAgentConfigGet();
          setAiAgentConfig(savedAiAgentConfig);
          setAiAgentKeyDrafts({});
          setAiAgentClearedKeys({});
        } catch {
          setAiAgentConfig(DEFAULT_AI_AGENT_CONFIG);
        }
      } catch {
        // Use defaults if settings not available yet
      }
      setLoaded(true);

      // Load system fonts in background
      try {
        const fonts = await api.listSystemFonts();
        setSystemFonts(fonts);
      } catch {
        // Fallback: empty list, user can still type manually
      }
    })();
  }, [maybeShowPredictiveEchoGuidance, setTheme, setUiTheme, setLocale]);

  const handleSave = async () => {
    if (saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      const enabledCats = COMMAND_ASSIST_ALL_IDS.filter((id) => caEnabledCategories[id]);
      let bgImagePathToSave = terminal.bgImagePath;
      if (bgImagePathToSave) {
        try {
          const importedPath = await importTerminalBackgroundImagePath(bgImagePathToSave);
          if (importedPath !== bgImagePathToSave) {
            bgImagePathToSave = importedPath;
            setTerminal((current) => ({ ...current, bgImagePath: importedPath }));
          }
        } catch {
          toast.error(t("settings.imageImportFailed"));
          setSaveStatus("error");
          setTimeout(() => setSaveStatus("idle"), 2000);
          return;
        }
      }
      await api.settingSetMany([
        { key: "theme", value: theme },
        { key: "ui.theme", value: uiTheme },
        { key: "locale", value: locale },
        { key: "terminal.fontFamily", value: terminal.fontFamily },
        { key: "terminal.fontSize", value: String(terminal.fontSize) },
        { key: "terminal.fontWeight", value: String(terminal.fontWeight) },
        { key: "terminal.lineHeight", value: String(terminal.lineHeight) },
        { key: "terminal.fontLigatures", value: String(terminal.fontLigatures) },
        { key: "terminal.foreground", value: terminal.foreground },
        { key: "terminal.cursor", value: terminal.cursor },
        { key: "terminal.cursorStyle", value: terminal.cursorStyle },
        { key: "terminal.cursorWidth", value: String(terminal.cursorWidth) },
        { key: "terminal.ansiColors", value: JSON.stringify(terminal.ansiColors) },
        { key: "terminal.selectionBg", value: terminal.selectionBg },
        { key: "confirmDangerousActions", value: String(confirmDanger) },
        { key: "session.keepAlive", value: sessionTimeout },
        { key: "transfer.chunkSize", value: chunkSize },
        { key: "transfer.maxConcurrent", value: maxConcurrent },
        { key: "transfer.timeout", value: transferTimeout },
        { key: "transfer.retryCount", value: retryCount },
        { key: "transfer.downloadPath", value: downloadPath },
        { key: "transfer.notify", value: String(transferNotify) },
        { key: "terminal.bgSource", value: terminal.bgSource },
        { key: "terminal.bgColor", value: terminal.bgColor },
        { key: "terminal.bgImagePath", value: bgImagePathToSave },
        { key: "terminal.bgOpacity", value: String(terminal.bgOpacity) },
        { key: "terminal.bgBlur", value: String(terminal.bgBlur) },
        { key: "ui.fontFamily", value: uiFontFamily },
        { key: "ui.fontSize", value: String(uiFontSize) },
        { key: "terminal.encoding", value: terminal.encoding },
        { key: "terminal.setLocale", value: String(terminal.setLocale) },
        { key: "terminal.fileManagerDrawer.enabled", value: String(terminal.fileManagerDrawerEnabled) },
        { key: "terminal.dangerousCmdProtection", value: String(terminal.dangerousCmdProtection) },
        { key: "terminal.disabledBuiltinCmds", value: JSON.stringify(terminal.disabledBuiltinCmds) },
        { key: "terminal.customDangerousCommands", value: JSON.stringify(terminal.customDangerousCommands) },
        { key: "terminal.predictiveEcho.enabled", value: String(predictiveEchoEnabled) },
        { key: "terminal.predictiveEcho.showPasswordInput", value: String(predictiveEchoShowPasswordInput) },
        { key: "commandAssist.enabled", value: String(caEnabled) },
        { key: "commandAssist.mode", value: caMode },
        { key: "commandAssist.confirmKey", value: caConfirmKey },
        { key: "commandAssist.position", value: caPosition },
        { key: "commandAssist.enabledAppCategories", value: JSON.stringify(enabledCats) },
      ]);
      const savedAiAgentConfig = await api.aiAgentConfigSave(aiAgentConfig);
      const savedProfileIds = new Set(savedAiAgentConfig.profiles.map((profile) => profile.id));
      await Promise.all([
        ...Object.entries(aiAgentKeyDrafts)
          .filter(([profileId, value]) => savedProfileIds.has(profileId) && value.trim())
          .map(([profileId, value]) => api.aiAgentProfileSetKey(profileId, value.trim())),
        ...Object.keys(aiAgentClearedKeys)
          .filter((profileId) => savedProfileIds.has(profileId) && aiAgentClearedKeys[profileId] && !aiAgentKeyDrafts[profileId]?.trim())
          .map((profileId) => api.aiAgentProfileClearKey(profileId)),
      ]);
      const refreshedAiAgentConfig = await api.aiAgentConfigGet();
      setAiAgentConfig(refreshedAiAgentConfig);
      setAiAgentKeyDrafts({});
      setAiAgentClearedKeys({});
      // Backend write succeeded — now commit to global store / runtime so
      // theme + locale visuals flip, terminals re-read settings, etc.
      setStoreTheme(theme);
      setStoreUiTheme(uiTheme);
      setStoreLocale(locale);
      useCommandAssistStore.getState().load();
      window.dispatchEvent(new CustomEvent("terminal:settings-changed"));
      lastSavedRef.current = JSON.stringify({
        ...snapshotValue,
        aiAgentConfig: refreshedAiAgentConfig,
        aiAgentKeyDrafts: {},
        aiAgentClearedKeys: {},
      });
      setSettingsDirty(false);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  const handleReset = () => {
    setTerminal(DEFAULT_TERMINAL);
    setTheme("dark");
    setUiTheme("classic");
    setLocale("zh");
    setUiFontFamily(DEFAULT_UI_FONT_FAMILY);
    setUiFontSize(DEFAULT_UI_FONT_SIZE);
    setConfirmDanger(true);
    setSessionTimeout("30");
    setChunkSize("256");
    setMaxConcurrent("3");
    setTransferTimeout("300");
    setRetryCount("3");
    setDownloadPath("");
    setTransferNotify(true);
    setPredictiveEchoEnabled(true);
    setCaEnabled(false);
    setCaConfirmKey("tab");
    setCaPosition("bottom-left");
    const cats: Record<string, boolean> = {};
    for (const id of COMMAND_ASSIST_ALL_IDS) cats[id] = true;
    setCaEnabledCategories(cats);
    setAiAgentConfig(DEFAULT_AI_AGENT_CONFIG);
    setAiAgentKeyDrafts({});
    setAiAgentClearedKeys({});
    setResetDone(true);
    setTimeout(() => setResetDone(false), 600);
  };

  const handleClearAllHistory = async () => {
    const ok = await confirm({
      title: t("settings.clearAllHistory"),
      description: t("settings.clearAllHistoryConfirm"),
      confirmLabel: t("settings.clear"),
      cancelLabel: t("settings.cancel"),
    });
    if (!ok) return;
    try {
      await api.commandHistoryClear(null);
      setClearHistoryStatus(true);
      setTimeout(() => setClearHistoryStatus(false), 2000);
    } catch {
      // ignore
    }
  };

  const confirmUpdateRestart = async () => {
    const hasActiveWork = connectedCount > 0 || activeTransfers > 0;
    const ok = await useConfirmStore.getState()._show({
      title: t("update.restartTitle"),
      description: hasActiveWork ? t("update.restartActiveDesc") : t("update.restartDesc"),
      confirmLabel: t("update.restartNow"),
      cancelLabel: t("update.later"),
      confirmVariant: "default",
    });
    if (ok) await restartUpdatedApp();
  };

  const renderAboutUpdateAction = () => {
    if (updateStatus === "checking") {
      return (
        <Button size="sm" disabled>
          <RefreshCw size={13} className="animate-spin" />
          {t("update.checking")}
        </Button>
      );
    }

    if (updateStatus === "available") {
      return (
        <Button size="sm" onClick={downloadAndInstallUpdate}>
          <RefreshCw size={13} />
          {t("update.downloadInstall")}
        </Button>
      );
    }

    if (updateStatus === "downloading") {
      return (
        <Button size="sm" disabled>
          <RefreshCw size={13} className="animate-spin" />
          {updateProgress.percent === null
            ? t("update.downloading")
            : t("update.downloadingProgress", { n: updateProgress.percent })}
          {updateSlowNetwork ? ` · ${t("update.slowNetwork")}` : ""}
        </Button>
      );
    }

    if (updateStatus === "installing") {
      return (
        <Button size="sm" disabled>
          <RefreshCw size={13} className="animate-spin" />
          {t("update.installing")}
        </Button>
      );
    }

    if (updateStatus === "readyToRestart") {
      return (
        <Button size="sm" onClick={confirmUpdateRestart}>
          <RefreshCw size={13} />
          {t("update.restartNow")}
        </Button>
      );
    }

    if (updateStatus === "restarting") {
      return (
        <Button size="sm" disabled>
          <RefreshCw size={13} className="animate-spin" />
          {t("update.restarting")}
        </Button>
      );
    }

    if (updateStatus === "unsupported" || updateStatus === "downloadFailed" || updateStatus === "installFailed") {
      return (
        <Button size="sm" variant="secondary" onClick={openUpdateFallback}>
          <RefreshCw size={13} />
          {t("update.openReleases")}
        </Button>
      );
    }

    return (
      <Button size="sm" onClick={checkForUpdate}>
        <RefreshCw size={13} />
        {t("settings.checkUpdate")}
      </Button>
    );
  };

  // Predictive Echo toggle — draft only, commits on Save.
  const handleTogglePredictiveEcho = (newVal: boolean) => {
    setPredictiveEchoEnabled(newVal);
    if (!newVal) return;
    // First-enable guidance toast (once per device, tracked in localStorage so
    // it persists across session storage clears).
    maybeShowPredictiveEchoGuidance();
  };

  const handleTabChange = (tab: SettingsTab) => {
    const prevIdx = TABS.indexOf(activeTab);
    const nextIdx = TABS.indexOf(tab);
    if (nextIdx !== prevIdx) {
      setSlideDir(nextIdx > prevIdx ? "right" : "left");
      setActiveTab(tab);
    }
  };

  const focusTab = (tab: SettingsTab) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`settings-tab-${tab}`)?.focus();
    });
  };

  const handleTabKeyDown = (tab: SettingsTab, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = TABS.indexOf(tab);
    let nextTab: SettingsTab | null = null;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextTab = TABS[(currentIndex + 1) % TABS.length];
        break;
      case "ArrowUp":
      case "ArrowLeft":
        nextTab = TABS[(currentIndex - 1 + TABS.length) % TABS.length];
        break;
      case "Home":
        nextTab = TABS[0];
        break;
      case "End":
        nextTab = TABS[TABS.length - 1];
        break;
      default:
        return;
    }

    event.preventDefault();
    handleTabChange(nextTab);
    focusTab(nextTab);
  };

  const tabItems = useMemo(() => SETTINGS_TAB_META.map((item) => ({
    ...item,
    label: t(item.labelKey),
    description: t(item.descKey),
  })), [t]);
  const filteredTabItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tabItems;
    return tabItems.filter(({ label }) => label.toLowerCase().includes(query));
  }, [searchQuery, tabItems]);

  useEffect(() => {
    if (filteredTabItems.length === 0) return;
    if (!filteredTabItems.some((item) => item.value === activeTab)) {
      setActiveTab(filteredTabItems[0].value);
    }
  }, [activeTab, filteredTabItems]);

  const activeTabMeta = tabItems.find((item) => item.value === activeTab) ?? tabItems[0];
  const hasFilteredTabs = filteredTabItems.length > 0;
  const currentUiThemeLabel = committedUiTheme === "lumenreef"
    ? t("settings.uiThemeLumenReef")
    : committedUiTheme === "inkpaper"
      ? t("settings.uiThemeInkpaper")
      : committedUiTheme === "graphite-forge"
        ? t("settings.uiThemeGraphiteForge")
        : committedUiTheme === "frostplain"
          ? t("settings.uiThemeFrostplain")
          : committedUiTheme === "draftgrid"
            ? t("settings.uiThemeDraftgrid")
            : committedUiTheme === "cloudrift"
              ? t("settings.uiThemeCloudrift")
              : committedUiTheme === "obsidian-sand"
                ? t("settings.uiThemeObsidianSand")
                : committedUiTheme === "abyssal-vent"
                  ? t("settings.uiThemeAbyssalVent")
                  : committedUiTheme === "aurora"
                    ? t("settings.uiThemeAurora")
                    : t("settings.uiThemeClassic");
  const currentModeLabel = committedTheme === "dark" ? t("settings.dark") : committedTheme === "light" ? t("settings.light") : t("settings.system");
  const activePanelId = `settings-panel-${activeTab}`;
  const activeTabId = `settings-tab-${activeTab}`;
  const paneStatusTone = saveStatus === "idle" ? undefined : saveStatus === "error" ? "error" : saveStatus === "saving" ? "saving" : "saved";
  const paneStatusLabel = saveStatus === "idle" ? undefined : saveStatus === "saving"
    ? t("settings.saving")
    : saveStatus === "error"
      ? t("settings.saveFailed")
      : t("settings.saved");
  const heroSectionLabel = hasFilteredTabs ? activeTabMeta.label : t("settings.navSearchEmptyTitle");
  const heroSectionDescription = hasFilteredTabs ? activeTabMeta.description : t("settings.navSearchEmptyDesc");
  // Save 按钮 disabled：dirty=false（无改动）或 saving=true（重复点击保护）
  const isDirty = lastSavedRef.current !== null && draftSnapshot !== lastSavedRef.current;
  const saveDisabled = !isDirty || saveStatus === "saving";

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">{t("settings.loadingSettings")}</p>
      </div>
    );
  }

  return (
    <div className="settings-page settings-main settings-page--aurora relative flex-1 overflow-hidden">
      <div className="page-header">
        <div className="title-block">
          <span className="title">{t("settings.title")}</span>
          <span className="subtitle">{t("settings.heroSubtitle")}</span>
        </div>
        <div className="actions">
          <Button size="sm" variant="ghost" onClick={handleReset} className="btn btn-ghost btn-sm">
            <span key={resetDone ? "spinning" : "idle"} className={resetDone ? "icon-spin" : ""}>
              <RotateCcw size={13} />
            </span>
            {t("settings.resetToDefault")}
          </Button>
          <Button size="sm" variant="secondary" onClick={handleSave} disabled={saveDisabled} className="btn btn-secondary btn-sm">
            {saveStatus === "saved" ? (
              <span key="check" className="icon-swap-enter"><Check size={13} /></span>
            ) : saveStatus === "saving" ? (
              <span key="saving" className="icon-spin"><Save size={13} /></span>
            ) : (
              <span key="save"><Save size={13} /></span>
            )}
            {t("settings.save")}
          </Button>
        </div>
      </div>
      <div className="settings-body">
          <aside className="settings-nav settings-nav-panel">
            <div className="input-with-icon settings-search settings-nav-search">
              <span className="input-icon settings-nav-search__icon" aria-hidden="true">
                <Search size={13} />
              </span>
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("settings.navSearchPlaceholder")}
                aria-label={t("settings.navSearchPlaceholder")}
                className="input settings-nav-search__input"
              />
            </div>

            <nav className="settings-cat-list settings-nav-list" aria-label={t("settings.title")} role="tablist" aria-orientation="vertical">
              {filteredTabItems.map(({ value, icon: Icon, label }) => {
                const active = activeTab === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleTabChange(value)}
                    onKeyDown={(event) => handleTabKeyDown(value, event)}
                    id={`settings-tab-${value}`}
                    role="tab"
                    data-active={active}
                    aria-selected={active}
                    aria-controls={`settings-panel-${value}`}
                    tabIndex={active ? 0 : -1}
                    className={`settings-cat settings-nav-button${active ? " is-active" : ""}`}
                  >
                    <span className="icon settings-nav-button__icon">
                      <Icon size={15} />
                    </span>
                    <span className="label block text-[var(--font-size-sm)] font-medium">{label}</span>
                  </button>
                );
              })}
              {filteredTabItems.length === 0 ? (
                <div className="settings-nav-empty" role="status" aria-live="polite">
                  <strong>{t("settings.navSearchEmptyTitle")}</strong>
                  <p>{t("settings.navSearchEmptyDesc")}</p>
                </div>
              ) : null}
            </nav>

            <div className="settings-account settings-account-card" aria-label={t("settings.accountTitle")}>
              <div className="avatar avatar-sm settings-account-card__avatar" aria-hidden="true">D</div>
              <div className="settings-account-info min-w-0 flex-1">
                <h3 className="settings-account-name settings-account-card__title">{t("settings.accountTitle")}</h3>
                <p className="settings-account-mail settings-account-card__subtitle">{t("settings.accountSubtitle")}</p>
              </div>
              <span className="settings-account-meta settings-account-card__meta">{currentUiThemeLabel} · {currentModeLabel}</span>
            </div>
          </aside>

          <section className="settings-pane min-w-0 flex-1 settings-content-panel">
            <div className="settings-cat-panel is-active">
              <header className="settings-pane-head settings-hero-card">
                <div>
                  <h2 className="settings-pane-title settings-hero-card__title">{heroSectionLabel}</h2>
                  <p className="settings-pane-sub settings-hero-card__subtitle">{heroSectionDescription}</p>
                </div>
                <div className="settings-hero-card__side">
                  <span className={`settings-pane-saved settings-pane-status settings-pane-status--${paneStatusTone ?? "idle"}${saveStatus === "idle" ? " settings-pane-saved--idle" : ""}`}>
                    <span className="settings-pane-status__dot" aria-hidden="true" />
                    {paneStatusLabel ?? t("settings.saved")}
                  </span>
                </div>
              </header>

              {hasFilteredTabs ? (
              <div
                key={activeTab}
                id={activePanelId}
                role="tabpanel"
                aria-labelledby={activeTabId}
                className={`tab-slide-in-${slideDir}`}
              >
        {activeTab === "general" && (<>
        <Section title={t("settings.uiThemeSection")} description={t("settings.uiThemeDesc")} className="settings-theme-section">
          <div className="space-y-3">
            <div className="theme-option-grid grid gap-3 md:grid-cols-2">
              {([
                {
                  value: "classic",
                  title: t("settings.uiThemeClassic"),
                  description: t("settings.uiThemeClassicDesc"),
                  previewClassName: "theme-preview theme-preview--classic",
                },
                {
                  value: "aurora",
                  title: t("settings.uiThemeAurora"),
                  description: t("settings.uiThemeAuroraDesc"),
                  previewClassName: "theme-preview theme-preview--aurora",
                },
                {
                  value: "abyssal-vent",
                  title: t("settings.uiThemeAbyssalVent"),
                  description: t("settings.uiThemeAbyssalVentDesc"),
                  previewClassName: "theme-preview theme-preview--abyssal-vent",
                },
                {
                  value: "obsidian-sand",
                  title: t("settings.uiThemeObsidianSand"),
                  description: t("settings.uiThemeObsidianSandDesc"),
                  previewClassName: "theme-preview theme-preview--obsidian-sand",
                },
                {
                  value: "cloudrift",
                  title: t("settings.uiThemeCloudrift"),
                  description: t("settings.uiThemeCloudriftDesc"),
                  previewClassName: "theme-preview theme-preview--cloudrift",
                },
                {
                  value: "draftgrid",
                  title: t("settings.uiThemeDraftgrid"),
                  description: t("settings.uiThemeDraftgridDesc"),
                  previewClassName: "theme-preview theme-preview--draftgrid",
                },
                {
                  value: "frostplain",
                  title: t("settings.uiThemeFrostplain"),
                  description: t("settings.uiThemeFrostplainDesc"),
                  previewClassName: "theme-preview theme-preview--frostplain",
                },
                {
                  value: "graphite-forge",
                  title: t("settings.uiThemeGraphiteForge"),
                  description: t("settings.uiThemeGraphiteForgeDesc"),
                  previewClassName: "theme-preview theme-preview--graphite-forge",
                },
                {
                  value: "inkpaper",
                  title: t("settings.uiThemeInkpaper"),
                  description: t("settings.uiThemeInkpaperDesc"),
                  previewClassName: "theme-preview theme-preview--inkpaper",
                },
                {
                  value: "lumenreef",
                  title: t("settings.uiThemeLumenReef"),
                  description: t("settings.uiThemeLumenReefDesc"),
                  previewClassName: "theme-preview theme-preview--lumenreef",
                },
              ] as const).map((option) => {
                const active = uiTheme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setUiTheme(option.value)}
                    data-active={active}
                    aria-pressed={active}
                    className="theme-option-card"
                  >
                    <div className={option.previewClassName} aria-hidden="true">
                      <span className="theme-preview__sidebar" />
                      <span className="theme-preview__panel" />
                      <span className="theme-preview__panel theme-preview__panel--small" />
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-left">
                        <p className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
                          {option.title}
                        </p>
                        <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                          {option.description}
                        </p>
                      </div>
                      <span className={`theme-option-card__check${active ? " theme-option-card__check--active" : ""}`}>
                        <Check size={12} />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Section>

        <Section title={t("settings.appearance")}>
          <SettingRow label={t("settings.colorMode")} description={t("settings.colorModeDesc")}>
            <SegmentedControl
              value={theme}
              onChange={setTheme}
              options={[
                { value: "dark", label: <><Moon size={12} />{t("settings.dark")}</> },
                { value: "light", label: <><Sun size={12} />{t("settings.light")}</> },
                { value: "system", label: <><Monitor size={12} />{t("settings.system")}</> },
              ]}
            />
          </SettingRow>
          <SettingRow label={t("settings.language")} description={t("settings.languageDesc")}>
            <SegmentedControl
              value={locale}
              onChange={setLocale}
              options={[
                { value: "zh", label: <><Globe size={12} />中文</> },
                { value: "en", label: <><Globe size={12} />English</> },
              ]}
            />
          </SettingRow>
        </Section>

        {/* UI Font */}
        <Section title={t("settings.uiFont")}>
          <div className="space-y-3">
            <SettingRow label={t("settings.uiFontFamily")} description={t("settings.uiFontDesc")}>
              <Select
                value={uiFontFamily}
                onChange={(v) => setUiFontFamily(v)}
                options={[
                  { value: "", label: t("settings.systemDefault") },
                  ...systemFonts.map((font) => ({ value: font, label: font })),
                ]}
                className="w-64"
              />
            </SettingRow>

            <SettingRow label={t("settings.uiFontSize")} description="12 - 18 px">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={12}
                  max={18}
                  value={uiFontSize}
                  onChange={(e) => setUiFontSize(parseInt(e.target.value))}
                  className="range-mac"
                />
                <span className="w-8 text-right text-[var(--font-size-sm)]">
                  {uiFontSize}
                </span>
              </div>
            </SettingRow>
          </div>
        </Section>

        {/* Behavior */}
        <Section title={t("settings.behavior")}>
          <SettingRow
            label={t("settings.confirmDanger")}
            description={t("settings.confirmDangerDesc")}
          >
            <button
              onClick={() => setConfirmDanger(!confirmDanger)}
              data-state={confirmDanger ? "on" : "off"}
              className="toggle-switch"
            >
              <span className="toggle-thumb" />
            </button>
          </SettingRow>
        </Section>
        </>)}

        {activeTab === "transfer" && (<>
        <Section title={t("settings.transfer")}>
          <SettingRow
            label={t("settings.chunkSize")}
            description={t("settings.chunkSizeDesc")}
          >
            <Select
              value={chunkSize}
              onChange={setChunkSize}
              options={[
                { value: "64", label: "64 KB" },
                { value: "128", label: "128 KB" },
                { value: "256", label: "256 KB" },
                { value: "512", label: "512 KB" },
                { value: "1024", label: "1 MB" },
                { value: "2048", label: "2 MB" },
                { value: "4096", label: "4 MB" },
                { value: "8192", label: "8 MB" },
                { value: "16384", label: "16 MB" },
                { value: "32768", label: "32 MB" },
              ]}
            />
          </SettingRow>

          <SettingRow
            label={t("settings.maxConcurrent")}
            description={t("settings.maxConcurrentDesc")}
          >
            <SegmentedControl
              value={maxConcurrent}
              onChange={setMaxConcurrent}
              options={[
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "5", label: "5" },
                { value: "10", label: "10" },
              ]}
            />
          </SettingRow>

          <SettingRow
            label={t("settings.transferTimeout")}
            description={t("settings.transferTimeoutDesc")}
          >
            <SegmentedControl
              value={transferTimeout}
              onChange={setTransferTimeout}
              options={[
                { value: "60", label: "60s" },
                { value: "300", label: "5m" },
                { value: "600", label: "10m" },
                { value: "1800", label: "30m" },
              ]}
            />
          </SettingRow>

          <SettingRow
            label={t("settings.retryCount")}
            description={t("settings.retryCountDesc")}
          >
            <SegmentedControl
              value={retryCount}
              onChange={setRetryCount}
              options={[
                { value: "0", label: "0" },
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "5", label: "5" },
              ]}
            />
          </SettingRow>

          <SettingRow
            label={t("settings.downloadPath")}
            description={t("settings.downloadPathDesc")}
          >
            <div className="flex items-center gap-2">
              <Input
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
                placeholder={t("settings.downloadPathPlaceholder")}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    const selected = await open({
                      directory: true,
                      multiple: false,
                    });
                    if (selected) {
                      setDownloadPath(selected as string);
                    }
                  } catch {
                    // Fallback for non-Tauri environment
                  }
                }}
              >
                {t("settings.browse")}
              </Button>
            </div>
          </SettingRow>

          <SettingRow
            label={t("settings.transferNotify")}
            description={t("settings.transferNotifyDesc")}
          >
            <button
              onClick={() => setTransferNotify(!transferNotify)}
              data-state={transferNotify ? "on" : "off"}
              className="toggle-switch"
            >
              <span className="toggle-thumb" />
            </button>
          </SettingRow>
        </Section>
        </>)}

        {activeTab === "terminal" && (<>
        <Section title={t("settings.terminalFont")}>
          <div className="space-y-3">
            <SettingRow label={t("settings.fontFamily")}>
              <Select
                value={terminal.fontFamily}
                onChange={(v) => setTerminal((t) => ({ ...t, fontFamily: v }))}
                options={[
                  { value: DEFAULT_TERMINAL.fontFamily, label: t("settings.systemDefault") },
                  ...systemFonts.map((font) => ({ value: font, label: font })),
                ]}
                className="w-64"
              />
            </SettingRow>

            <SettingRow label={t("settings.fontSize")} description="10 - 24 px">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={10}
                  max={24}
                  value={terminal.fontSize}
                  onChange={(e) =>
                    setTerminal((t) => ({ ...t, fontSize: parseInt(e.target.value) }))
                  }
                  className="range-mac"
                />
                <span className="w-8 text-right text-[var(--font-size-sm)]">
                  {terminal.fontSize}
                </span>
              </div>
            </SettingRow>

            <SettingRow label={t("settings.fontWeight")}>
              <Select
                value={String(terminal.fontWeight)}
                onChange={(v) =>
                  setTerminal((t) => ({ ...t, fontWeight: parseInt(v) }))
                }
                options={[
                  { value: "400", label: `${t("settings.fontWeightRegular")} (400)` },
                  { value: "500", label: `${t("settings.fontWeightMedium")} (500)` },
                  { value: "600", label: `${t("settings.fontWeightSemibold")} (600)` },
                ]}
                className="w-40"
              />
            </SettingRow>

            <SettingRow label={t("settings.lineHeight")} description="1.2 - 1.8">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={12}
                  max={18}
                  value={Math.round(terminal.lineHeight * 10)}
                  onChange={(e) =>
                    setTerminal((t) => ({
                      ...t,
                      lineHeight: parseInt(e.target.value) / 10,
                    }))
                  }
                  className="range-mac"
                />
                <span className="w-8 text-right text-[var(--font-size-sm)]">
                  {terminal.lineHeight.toFixed(1)}
                </span>
              </div>
            </SettingRow>

            <SettingRow
              label={t("settings.fontLigatures")}
              description={t("settings.fontLigaturesDesc")}
            >
              <button
                onClick={() => setTerminal((t) => ({ ...t, fontLigatures: !t.fontLigatures }))}
                data-state={terminal.fontLigatures ? "on" : "off"}
                className="toggle-switch"
              >
                <span className="toggle-thumb" />
              </button>
            </SettingRow>
          </div>
        </Section>

        <Section title={t("settings.cursor")}>
          <div className="space-y-3">
            <SettingRow label={t("settings.cursorColor")}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={terminal.cursor}
                  onChange={(e) =>
                    setTerminal((t) => ({ ...t, cursor: e.target.value }))
                  }
                  className="h-8 w-8 cursor-pointer rounded border border-[var(--color-border)]"
                />
                <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                  {terminal.cursor}
                </span>
              </div>
            </SettingRow>

            <SettingRow label={t("settings.cursorStyle")} description={t("settings.cursorStyleDesc")}>
              <SegmentedControl
                value={terminal.cursorStyle}
                onChange={(v) => setTerminal((prev) => ({ ...prev, cursorStyle: v as "bar" | "block" | "underline" }))}
                options={(["bar", "block", "underline"] as const).map((style) => ({
                  value: style,
                  label: (
                    <>
                      <span
                        className="inline-block"
                        style={{
                          width: style === "bar" ? 2 : 12,
                          height: style === "underline" ? 3 : 14,
                          backgroundColor: "currentColor",
                          borderRadius: style === "bar" ? 1 : (style === "underline" ? "0 0 1px 1px" : 1),
                          ...(style === "underline" ? { marginTop: 11 } : {}),
                        }}
                      />
                      {style === "bar" ? t("settings.cursorBar") : style === "block" ? t("settings.cursorBlock") : t("settings.cursorUnderline")}
                    </>
                  ),
                }))}
              />
            </SettingRow>

            <SettingRow label={t("settings.cursorWidth")} description="1 - 5">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={terminal.cursorWidth}
                  onChange={(e) =>
                    setTerminal((t) => ({ ...t, cursorWidth: parseInt(e.target.value) }))
                  }
                  className="range-mac"
                />
                <span className="w-4 text-right text-[var(--font-size-sm)]">
                  {terminal.cursorWidth}
                </span>
              </div>
            </SettingRow>
          </div>
        </Section>

        <Section title={t("settings.terminalBg")}>
          <div className="space-y-3">
            {/* Preview */}
            <div>
              <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                {t("settings.preview")}
              </p>
              <div
                className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-4"
                style={{
                  background: terminal.bgColor,
                  fontFamily: terminal.fontFamily,
                  fontSize: `${terminal.fontSize}px`,
                  fontWeight: terminal.fontWeight,
                  lineHeight: terminal.lineHeight,
                  color: terminal.foreground,
                }}
              >
                <div>
                  <span style={{ color: terminal.ansiColors.green }}>user</span>
                  <span>@</span>
                  <span style={{ color: terminal.ansiColors.cyan }}>server</span>
                  <span>:</span>
                  <span style={{ color: terminal.ansiColors.blue }}>~</span>
                  <span style={{ color: terminal.ansiColors.white }}>$ </span>
                  <span style={{ color: terminal.ansiColors.yellow }}>ls</span>
                  <span> --color</span>
                </div>
                <div>
                  <span style={{ color: terminal.ansiColors.blue }}>drwxr-xr-x</span>{" "}
                  <span>src/ </span>
                  <span style={{ color: terminal.ansiColors.cyan }}>README.md</span>{" "}
                  <span style={{ color: terminal.ansiColors.green }}>config.toml</span>
                </div>
                <div>
                  <span style={{ color: terminal.ansiColors.green }}>-rw-r--r--</span>{" "}
                  <span>package.json </span>
                  <span style={{ color: terminal.ansiColors.magenta }}>deploy.sh</span>
                </div>
                <div>
                  <span style={{ color: terminal.ansiColors.red }}>-rwxr-xr-x</span>{" "}
                  <span>build </span>
                  <span style={{ color: terminal.ansiColors.yellow }}>warning.log</span>
                </div>
              </div>
            </div>

            <SettingRow label={t("settings.foreground")}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={terminal.foreground}
                  onChange={(e) =>
                    setTerminal((t) => ({ ...t, foreground: e.target.value }))
                  }
                  className="h-8 w-8 cursor-pointer rounded border border-[var(--color-border)]"
                />
                <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                  {terminal.foreground}
                </span>
              </div>
            </SettingRow>

            {/* ANSI Color Theme */}
            <div className="py-2">
              <p className="text-[var(--font-size-sm)]">{t("settings.ansiColors")}</p>
              <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                {t("settings.ansiColorsDesc")}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {COLOR_THEMES.map((theme) => {
                  const active = JSON.stringify(terminal.ansiColors) === JSON.stringify(theme.colors);
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setTerminal((prev) => ({ ...prev, ansiColors: { ...theme.colors } }))}
                      className={active ? "lang-chip lang-chip--active" : "lang-chip"}
                    >
                      <span className="flex items-center gap-0.5">
                        {(["red", "green", "yellow", "blue", "magenta", "cyan"] as const).map((c) => (
                          <span
                            key={c}
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: theme.colors[c] }}
                          />
                        ))}
                      </span>
                      {theme.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* FR-33: Readability Protection */}
            {(() => {
              const ratio = contrastRatio(terminal.foreground, terminal.bgColor);
              const isLow = ratio < 4.5;
              return isLow ? (
                <div className="mt-3 flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-fair)]/30 bg-[var(--color-fair)]/10 p-3">
                  <AlertTriangle size={16} className="shrink-0 text-[var(--color-fair)]" />
                  <div className="flex-1">
                    <p className="text-[var(--font-size-xs)] text-[var(--color-fair)]">
                      {t("settings.lowContrast")} ({ratio.toFixed(1)}:1). {t("settings.textHardToRead")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setTerminal((t) => {
                        const safeFg = safeContrast(t.bgColor);
                        const bgL = luminance(t.bgColor);
                        const safeCursor = bgL > 0.4 ? "#2563EB" : "#3B82F6";
                        return { ...t, foreground: safeFg, cursor: safeCursor };
                      });
                    }}
                  >
                    {t("settings.fix")}
                  </Button>
                </div>
              ) : null;
            })()}

            <SettingRow label={t("settings.bgSource")}>
              <SegmentedControl
                value={terminal.bgSource}
                onChange={(v) => setTerminal((t) => ({ ...t, bgSource: v }))}
                options={[
                  { value: "color", label: t("settings.color") },
                  { value: "image", label: t("settings.image") },
                ]}
              />
            </SettingRow>

            {terminal.bgSource === "color" && (
              <SettingRow label={t("settings.bgColor")}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={terminal.bgColor}
                    onChange={(e) =>
                      setTerminal((t) => ({ ...t, bgColor: e.target.value }))
                    }
                    className="h-8 w-8 cursor-pointer rounded border border-[var(--color-border)]"
                  />
                  <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                    {terminal.bgColor}
                  </span>
                </div>
              </SettingRow>
            )}

            {terminal.bgSource === "image" && (
              <SettingRow label={t("settings.imagePath")}>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const file = await open({
                        title: t("settings.selectImage"),
                        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
                        multiple: false,
                      });
                      if (file) {
                        try {
                          const importedPath = await importTerminalBackgroundImagePath(file as string);
                          setTerminal((t) => ({ ...t, bgImagePath: importedPath }));
                        } catch {
                          toast.error(t("settings.imageImportFailed"));
                        }
                      }
                    }}
                  >
                    <FolderOpen size={12} />
                    {t("settings.selectImage")}
                  </Button>
                  {terminal.bgImagePath && (
                    <>
                      <span className="max-w-40 truncate text-[var(--font-size-xs)] text-[var(--color-text-muted)]" title={terminal.bgImagePath}>
                        {terminal.bgImagePath.split("/").pop() || terminal.bgImagePath}
                      </span>
                      <button
                        onClick={() => setTerminal((t) => ({ ...t, bgImagePath: "" }))}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                      >
                        <X size={14} />
                      </button>
                    </>
                  )}
                  {!terminal.bgImagePath && (
                    <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                      {t("settings.noImageSelected")}
                    </span>
                  )}
                </div>
              </SettingRow>
            )}

            <SettingRow label={t("settings.opacity")} description="0 - 100%">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={terminal.bgOpacity}
                  onChange={(e) =>
                    setTerminal((t) => ({ ...t, bgOpacity: parseInt(e.target.value) }))
                  }
                  className="range-mac"
                />
                <span className="w-12 text-right text-[var(--font-size-sm)]">
                  {terminal.bgOpacity}%
                </span>
              </div>
            </SettingRow>

            <SettingRow label={t("settings.blur")} description="0 - 20 px">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={terminal.bgBlur}
                  onChange={(e) =>
                    setTerminal((t) => ({ ...t, bgBlur: parseInt(e.target.value) }))
                  }
                  className="range-mac"
                />
                <span className="w-12 text-right text-[var(--font-size-sm)]">
                  {terminal.bgBlur}px
                </span>
              </div>
            </SettingRow>

            <div className="pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setTerminal((t) => ({
                    ...t,
                    bgSource: DEFAULT_TERMINAL.bgSource,
                    bgColor: DEFAULT_TERMINAL.bgColor,
                    bgImagePath: DEFAULT_TERMINAL.bgImagePath,
                    bgOpacity: DEFAULT_TERMINAL.bgOpacity,
                    bgBlur: DEFAULT_TERMINAL.bgBlur,
                  }))
                }
              >
                <RotateCcw size={12} />
                {t("settings.resetToDefault")}
              </Button>
            </div>
          </div>
        </Section>

        <Section title={t("settings.terminalSession")}>
          <SettingRow
            label={t("settings.sessionTimeout")}
            description={t("settings.sessionTimeoutDesc")}
          >
            <SegmentedControl
              value={sessionTimeout}
              onChange={setSessionTimeout}
              options={[
                { value: "30", label: t("settings.timeout30s") },
                { value: "300", label: t("settings.timeout5m") },
                { value: "1800", label: t("settings.timeout30m") },
                { value: "0", label: t("settings.timeoutNever") },
              ]}
            />
          </SettingRow>
          <SettingRow
            label={t("settings.encoding")}
            description={t("settings.encodingDesc")}
          >
            <Select
              value={terminal.encoding}
              onChange={(v) => setTerminal((t) => ({ ...t, encoding: v }))}
              options={[
                { value: "utf-8", label: "UTF-8" },
                { value: "gbk", label: "GBK" },
                { value: "gb18030", label: "GB18030" },
                { value: "big5", label: "Big5" },
                { value: "shift_jis", label: "Shift_JIS" },
                { value: "euc-kr", label: "EUC-KR" },
              ]}
              className="w-40"
            />
          </SettingRow>
          <SettingRow
            label={t("settings.setLocale")}
            description={t("settings.setLocaleDesc")}
          >
            <button
              onClick={() => setTerminal((t) => ({ ...t, setLocale: !t.setLocale }))}
              data-state={terminal.setLocale ? "on" : "off"}
              className="toggle-switch"
            >
              <span className="toggle-thumb" />
            </button>
          </SettingRow>
          <SettingRow
            label={t("settings.terminalFileManager")}
            description={t("settings.terminalFileManagerDesc")}
          >
            <button
              onClick={() => setTerminal((t) => ({ ...t, fileManagerDrawerEnabled: !t.fileManagerDrawerEnabled }))}
              data-state={terminal.fileManagerDrawerEnabled ? "on" : "off"}
              className="toggle-switch"
            >
              <span className="toggle-thumb" />
            </button>
          </SettingRow>

          <div className="flex items-center justify-between py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[var(--font-size-sm)]">{t("settings.clearAllHistory")}</p>
              <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                {t("settings.clearAllHistoryDesc")}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleClearAllHistory}
            >
              {clearHistoryStatus ? <Check size={12} /> : <Trash2 size={12} />}
              {clearHistoryStatus ? t("settings.done") : t("settings.clear")}
            </Button>
          </div>
        </Section>

        <Section title={t("settings.predictiveEcho")}>
          <SettingRow
            label={t("settings.predictiveEcho")}
            description={t("settings.predictiveEchoDesc")}
          >
            <button
              onClick={() => handleTogglePredictiveEcho(!predictiveEchoEnabled)}
              data-state={predictiveEchoEnabled ? "on" : "off"}
              className="toggle-switch"
            >
              <span className="toggle-thumb" />
            </button>
          </SettingRow>
          <SettingRow
            label={t("settings.predictiveEchoShowPasswordInput")}
            description={t("settings.predictiveEchoShowPasswordInputDesc")}
            indented
          >
            <button
              onClick={() => setPredictiveEchoShowPasswordInput((value) => !value)}
              data-state={predictiveEchoShowPasswordInput ? "on" : "off"}
              className="toggle-switch"
            >
              <span className="toggle-thumb" />
            </button>
          </SettingRow>
        </Section>

        <Section title={t("settings.cmdProtection")}>
          <SettingRow
            label={t("settings.cmdProtection")}
            description={t("settings.cmdProtectionDesc")}
          >
            <button
              onClick={() => setTerminal((t) => ({ ...t, dangerousCmdProtection: !t.dangerousCmdProtection }))}
              data-state={terminal.dangerousCmdProtection ? "on" : "off"}
              className="toggle-switch"
            >
              <span className="toggle-thumb" />
            </button>
          </SettingRow>

          {terminal.dangerousCmdProtection && (
            <div className="py-2">
              {/* Built-in commands: toggle only, cannot delete */}
              <div className="flex flex-col gap-1.5">
                {DEFAULT_DANGEROUS_COMMANDS.map((cmd) => {
                  const disabled = terminal.disabledBuiltinCmds.includes(cmd);
                  return (
                    <div key={cmd} className="flex items-center justify-between rounded border border-[var(--color-border)] px-2 py-1">
                      <span className="flex items-center gap-2">
                        <code className={`text-[var(--font-size-xs)] ${disabled ? "line-through text-[var(--color-text-muted)]" : ""}`}>{cmd}</code>
                        <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                          {t("settings.builtin")}
                        </span>
                      </span>
                      <button
                        onClick={() => setTerminal((t) => ({
                          ...t,
                          disabledBuiltinCmds: disabled
                            ? t.disabledBuiltinCmds.filter((c) => c !== cmd)
                            : [...t.disabledBuiltinCmds, cmd],
                        }))}
                        data-state={disabled ? "off" : "on"}
                        className="toggle-switch"
                        style={{ transform: "scale(0.7)" }}
                      >
                        <span className="toggle-thumb" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Custom commands: can delete */}
              {terminal.customDangerousCommands.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {terminal.customDangerousCommands.map((cmd, i) => (
                    <div key={i} className="flex items-center justify-between rounded border border-[var(--color-border)] px-2 py-1">
                      <code className="text-[var(--font-size-xs)]">{cmd}</code>
                      <button
                        onClick={() => setTerminal((t) => ({
                          ...t,
                          customDangerousCommands: t.customDangerousCommands.filter((_, j) => j !== i),
                        }))}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-2 flex gap-1.5">
                <input
                  id="add-dangerous-cmd"
                  type="text"
                  placeholder={t("settings.addCommand")}
                  className="flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[var(--font-size-xs)] outline-none focus:border-[var(--color-primary)]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const input = e.currentTarget;
                      const val = input.value.trim();
                      if (val && !terminal.customDangerousCommands.includes(val)) {
                        setTerminal((t) => ({ ...t, customDangerousCommands: [...t.customDangerousCommands, val] }));
                        input.value = "";
                      }
                    }
                  }}
                />
                <button
                  onClick={() => {
                    const input = document.getElementById("add-dangerous-cmd") as HTMLInputElement;
                    const val = input?.value.trim();
                    if (val && !terminal.customDangerousCommands.includes(val)) {
                      setTerminal((t) => ({ ...t, customDangerousCommands: [...t.customDangerousCommands, val] }));
                      input.value = "";
                    }
                  }}
                  className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[var(--font-size-xs)] hover:bg-[var(--color-bg-hover)]"
                >
                  <Plus size={10} />
                </button>
              </div>
            </div>
          )}
        </Section>
        </>)}

        {activeTab === "commandAssist" && (<>
        <CommandAssistSettings
          t={t}
          enabled={caEnabled}
          mode={caMode}
          confirmKey={caConfirmKey}
          position={caPosition}
          enabledCategories={caEnabledCategories}
          onToggleEnabled={setCaEnabled}
          onChangeMode={setCaMode}
          onChangeConfirmKey={setCaConfirmKey}
          onChangePosition={setCaPosition}
          onChangeCategories={setCaEnabledCategories}
        />
        </>)}

        {activeTab === "aiAgent" && (<>
        <AiAgentSettings
          t={t}
          config={aiAgentConfig}
          keyDrafts={aiAgentKeyDrafts}
          clearedKeys={aiAgentClearedKeys}
          onChange={setAiAgentConfig}
          onChangeKeyDraft={(profileId, value) => {
            setAiAgentKeyDrafts((current) => ({ ...current, [profileId]: value }));
            if (value.trim()) {
              setAiAgentClearedKeys((current) => ({ ...current, [profileId]: false }));
            }
          }}
          onClearKey={(profileId) => {
            setAiAgentKeyDrafts((current) => ({ ...current, [profileId]: "" }));
            setAiAgentClearedKeys((current) => ({ ...current, [profileId]: true }));
            setAiAgentConfig((current) => ({
              ...current,
              profiles: current.profiles.map((profile) => (
                profile.id === profileId ? { ...profile, apiKeySet: false } : profile
              )),
            }));
          }}
        />
        </>)}

        {activeTab === "shortcuts" && (<>
        <ShortcutsSettings t={t} />
        </>)}

        {activeTab === "about" && (<>
        <div className="settings-about-card card-glow">
          <div className="inner">
            <div className="settings-about-head">
              <span className="settings-about-logo" aria-hidden="true">
                <Logo size={56} />
              </span>
              <div>
                <h3 className="settings-about-name">DdShell</h3>
                <p className="settings-about-tag">{t("settings.aboutTagline")}</p>
              </div>
            </div>
            <ul className="settings-about-meta">
              <li><span className="muted">{t("settings.version")}</span><span className="mono">v{appVersion}</span></li>
              <li><span className="muted">{t("settings.aboutBuild")}</span><span className="mono">{import.meta.env.MODE}</span></li>
              <li><span className="muted">{t("settings.aboutRuntime")}</span><span className="mono">{APP_RUNTIME}</span></li>
              <li><span className="muted">{t("settings.aboutPlatform")}</span><span className="mono">{appPlatform}</span></li>
            </ul>
            <div className="settings-about-actions">
              {renderAboutUpdateAction()}
              <Button size="sm" variant="ghost" onClick={() => void api.openBrowser(GITHUB_REPO_URL)}>
                <Github size={13} />
                GitHub
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void api.openBrowser(GITHUB_ISSUES_URL)}>
                <MessageSquare size={13} />
                {t("settings.aboutFeedback")}
              </Button>
            </div>
            {(updateStatus === "downloading" || updateStatus === "installing") && (
              <div className="settings-about-update-progress">
                <UpdaterProgress
                  percent={updateStatus === "downloading" ? updateProgress.percent : null}
                  slowNetwork={updateStatus === "downloading" && updateSlowNetwork}
                />
              </div>
            )}
            {(updateStatus === "available" || updateStatus === "upToDate" || updateStatus === "checkFailed" || updateStatus === "readyToRestart") && (
              <div className="mt-3">
                <p className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                  {updateStatus === "available" && t("update.available").replace("{v}", updateLatestVersion)}
                  {updateStatus === "upToDate" && t("update.latest")}
                  {updateStatus === "checkFailed" && t("update.failed")}
                  {updateStatus === "readyToRestart" && t("update.readyToRestart")}
                </p>
              </div>
            )}
          </div>
        </div>

        <Section title={t("settings.dataPrivacy")}>
          <p className="text-[var(--font-size-sm)] leading-relaxed text-[var(--color-text-secondary)]">
            {t("settings.dataPrivacyDesc")}
          </p>
        </Section>

        <Section title={t("settings.credits")}>
          <ul className="settings-credits">
            <li><span className="settings-credit-name">Tauri</span><span className="muted">{t("settings.creditTauriDesc")}</span></li>
            <li><span className="settings-credit-name">React 19 · Vite</span><span className="muted">{t("settings.creditReactDesc")}</span></li>
            <li><span className="settings-credit-name">xterm.js</span><span className="muted">{t("settings.creditXtermDesc")}</span></li>
            <li><span className="settings-credit-name">russh</span><span className="muted">{t("settings.creditRusshDesc")}</span></li>
            <li><span className="settings-credit-name">CodeMirror 6</span><span className="muted">{t("settings.creditCodemirrorDesc")}</span></li>
            <li><span className="settings-credit-name">Inter · JetBrains Mono</span><span className="muted">{t("settings.creditFontsDesc")}</span></li>
          </ul>
        </Section>
        </>)}
              </div>
              ) : (
                <section className="settings-group settings-section">
                  <strong className="block text-[var(--font-size-base)] font-semibold text-[var(--color-text-primary)]">
                    {t("settings.navSearchEmptyTitle")}
                  </strong>
                  <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
                    {t("settings.navSearchEmptyDesc")}
                  </p>
                </section>
              )}
            </div>
          </section>
        </div>

    </div>
  );
}
