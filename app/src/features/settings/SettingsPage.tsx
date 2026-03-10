import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, Save, RotateCcw, AlertTriangle, Globe, FolderOpen, X, Check } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useAppStore } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { getAppVersion } from "@/lib/constants";
import type { Locale } from "@/lib/i18n";
import * as api from "@/lib/tauri";
import type { TerminalBgSource } from "@/types";

const TABS = ["general", "terminal", "about"] as const;
type SettingsTab = (typeof TABS)[number];

type ThemeOption = "dark" | "light" | "system";

interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  fontLigatures: boolean;
  foreground: string;
  cursor: string;
  selectionBg: string;
  bgSource: TerminalBgSource;
  bgColor: string;
  bgImagePath: string;
  bgOpacity: number;
  bgBlur: number;
  encoding: string;
}

const DEFAULT_TERMINAL: TerminalSettings = {
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.4,
  fontLigatures: false,
  foreground: "#E5E7EB",
  cursor: "#3B82F6",
  selectionBg: "rgba(59, 130, 246, 0.3)",
  bgSource: "color",
  bgColor: "#0F1115",
  bgImagePath: "",
  bgOpacity: 100,
  bgBlur: 0,
  encoding: "utf-8",
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5">
      <h3 className="mb-4 text-[var(--font-size-base)] font-medium">{title}</h3>
      {children}
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[var(--font-size-sm)]">{label}</p>
        {description && (
          <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {description}
          </p>
        )}
      </div>
      <div className="ml-4 shrink-0">{children}</div>
    </div>
  );
}

const DEFAULT_UI_FONT_FAMILY = "";
const DEFAULT_UI_FONT_SIZE = 14;

export function SettingsPage() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const t = useT();

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");
  const [terminal, setTerminal] = useState<TerminalSettings>(DEFAULT_TERMINAL);
  const [uiFontFamily, setUiFontFamily] = useState(DEFAULT_UI_FONT_FAMILY);
  const [uiFontSize, setUiFontSize] = useState(DEFAULT_UI_FONT_SIZE);
  const [confirmDanger, setConfirmDanger] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [loaded, setLoaded] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [resetStatus, setResetStatus] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    getAppVersion().then(setAppVersion);
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
          savedSelectionBg,
          savedConfirmDanger,
          savedKeepAlive,
          savedBgSource,
          savedBgColor,
          savedBgImagePath,
          savedBgOpacity,
          savedBgBlur,
          savedLocale,
          savedUiFontFamily,
          savedUiFontSize,
          savedEncoding,
        ] = await Promise.all([
          api.settingGet("theme"),
          api.settingGet("terminal.fontFamily"),
          api.settingGet("terminal.fontSize"),
          api.settingGet("terminal.fontWeight"),
          api.settingGet("terminal.lineHeight"),
          api.settingGet("terminal.fontLigatures"),
          api.settingGet("terminal.foreground"),
          api.settingGet("terminal.cursor"),
          api.settingGet("terminal.selectionBg"),
          api.settingGet("confirmDangerousActions"),
          api.settingGet("session.keepAlive"),
          api.settingGet("terminal.bgSource"),
          api.settingGet("terminal.bgColor"),
          api.settingGet("terminal.bgImagePath"),
          api.settingGet("terminal.bgOpacity"),
          api.settingGet("terminal.bgBlur"),
          api.settingGet("locale"),
          api.settingGet("ui.fontFamily"),
          api.settingGet("ui.fontSize"),
          api.settingGet("terminal.encoding"),
        ]);

        if (savedTheme) setTheme(savedTheme as ThemeOption);
        if (savedLocale === "zh" || savedLocale === "en") setLocale(savedLocale as Locale);

        setTerminal({
          fontFamily: savedFontFamily || DEFAULT_TERMINAL.fontFamily,
          fontSize: savedFontSize ? parseInt(savedFontSize) : DEFAULT_TERMINAL.fontSize,
          fontWeight: savedFontWeight ? parseInt(savedFontWeight) : DEFAULT_TERMINAL.fontWeight,
          lineHeight: savedLineHeight ? parseFloat(savedLineHeight) : DEFAULT_TERMINAL.lineHeight,
          fontLigatures: savedFontLigatures === "true",
          foreground: savedForeground || DEFAULT_TERMINAL.foreground,
          cursor: savedCursor || DEFAULT_TERMINAL.cursor,
          selectionBg: savedSelectionBg || DEFAULT_TERMINAL.selectionBg,
          bgSource: (savedBgSource as TerminalBgSource) || DEFAULT_TERMINAL.bgSource,
          bgColor: savedBgColor || DEFAULT_TERMINAL.bgColor,
          bgImagePath: savedBgImagePath || DEFAULT_TERMINAL.bgImagePath,
          bgOpacity: savedBgOpacity ? parseInt(savedBgOpacity) : DEFAULT_TERMINAL.bgOpacity,
          bgBlur: savedBgBlur ? parseInt(savedBgBlur) : DEFAULT_TERMINAL.bgBlur,
          encoding: savedEncoding || DEFAULT_TERMINAL.encoding,
        });

        setConfirmDanger(savedConfirmDanger !== "false");
        setSessionTimeout(savedKeepAlive || "30");

        setUiFontFamily(savedUiFontFamily || DEFAULT_UI_FONT_FAMILY);
        setUiFontSize(savedUiFontSize ? parseInt(savedUiFontSize) : DEFAULT_UI_FONT_SIZE);
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
  }, [setTheme, setLocale]);

  const handleSave = async () => {
    try {
      await Promise.all([
        api.settingSet("theme", theme),
        api.settingSet("locale", locale),
        api.settingSet("terminal.fontFamily", terminal.fontFamily),
        api.settingSet("terminal.fontSize", String(terminal.fontSize)),
        api.settingSet("terminal.fontWeight", String(terminal.fontWeight)),
        api.settingSet("terminal.lineHeight", String(terminal.lineHeight)),
        api.settingSet("terminal.fontLigatures", String(terminal.fontLigatures)),
        api.settingSet("terminal.foreground", terminal.foreground),
        api.settingSet("terminal.cursor", terminal.cursor),
        api.settingSet("terminal.selectionBg", terminal.selectionBg),
        api.settingSet("confirmDangerousActions", String(confirmDanger)),
        api.settingSet("session.keepAlive", sessionTimeout),
        api.settingSet("terminal.bgSource", terminal.bgSource),
        api.settingSet("terminal.bgColor", terminal.bgColor),
        api.settingSet("terminal.bgImagePath", terminal.bgImagePath),
        api.settingSet("terminal.bgOpacity", String(terminal.bgOpacity)),
        api.settingSet("terminal.bgBlur", String(terminal.bgBlur)),
        api.settingSet("ui.fontFamily", uiFontFamily),
        api.settingSet("ui.fontSize", String(uiFontSize)),
        api.settingSet("terminal.encoding", terminal.encoding),
      ]);
      window.dispatchEvent(new CustomEvent("terminal:settings-changed"));
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
    setLocale("zh");
    setUiFontFamily(DEFAULT_UI_FONT_FAMILY);
    setUiFontSize(DEFAULT_UI_FONT_SIZE);
    setConfirmDanger(true);
    setSessionTimeout("30");
    setResetStatus(true);
    setTimeout(() => setResetStatus(false), 2000);
  };

  const handleTabChange = (tab: SettingsTab) => {
    const prevIdx = TABS.indexOf(activeTab);
    const nextIdx = TABS.indexOf(tab);
    if (nextIdx !== prevIdx) {
      setSlideDir(nextIdx > prevIdx ? "right" : "left");
      setActiveTab(tab);
    }
  };

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">{t("settings.loadingSettings")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-x-hidden overflow-y-scroll">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-[var(--font-size-xl)] font-medium">{t("settings.title")}</h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleReset}>
              {resetStatus
                ? <span key="check" className="icon-swap-enter"><Check size={14} /></span>
                : <span key="icon" className="icon-spin"><RotateCcw size={14} /></span>}
              {resetStatus ? t("settings.resetDone") : t("settings.reset")}
            </Button>
            <Button onClick={handleSave}>
              {saveStatus === "saved"
                ? <span key="check" className="icon-swap-enter"><Check size={14} /></span>
                : <Save size={14} />}
              {saveStatus === "saved"
                ? t("settings.saved")
                : saveStatus === "error"
                  ? t("settings.saveFailed")
                  : t("settings.save")}
            </Button>
          </div>
        </div>

        <SegmentedControl
          value={activeTab}
          onChange={handleTabChange}
          className="w-fit"
          options={[
            { value: "general", label: t("settings.tabGeneral") },
            { value: "terminal", label: t("settings.tabTerminal") },
            { value: "about", label: t("settings.tabAbout") },
          ]}
        />

        <div key={activeTab} className={`space-y-6 tab-slide-in-${slideDir}`}>
        {activeTab === "general" && (<>
        {/* Theme */}
        <Section title={t("settings.appearance")}>
          <SettingRow label={t("settings.theme")} description={t("settings.themeDesc")}>
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
              <select
                value={uiFontFamily}
                onChange={(e) => setUiFontFamily(e.target.value)}
                className="select-mac w-64"
              >
                <option value="">{t("settings.systemDefault")}</option>
                {systemFonts.map((font) => (
                  <option key={font} value={font}>{font}</option>
                ))}
              </select>
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

        {activeTab === "terminal" && (<>
        <Section title={t("settings.terminalFont")}>
          <div className="space-y-3">
            <SettingRow label={t("settings.fontFamily")}>
              <select
                value={terminal.fontFamily}
                onChange={(e) =>
                  setTerminal((t) => ({ ...t, fontFamily: e.target.value }))
                }
                className="select-mac w-64"
              >
                <option value={DEFAULT_TERMINAL.fontFamily}>{t("settings.systemDefault")}</option>
                {systemFonts.map((font) => (
                  <option key={font} value={font}>{font}</option>
                ))}
              </select>
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
              <select
                value={terminal.fontWeight}
                onChange={(e) =>
                  setTerminal((t) => ({ ...t, fontWeight: parseInt(e.target.value) }))
                }
                className="select-mac"
              >
                <option value={400}>Regular (400)</option>
                <option value={500}>Medium (500)</option>
                <option value={600}>Semibold (600)</option>
              </select>
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

        <Section title={t("settings.terminalColors")}>
          <div className="space-y-3">
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

            <SettingRow label={t("settings.cursor")}>
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

            {/* Preview */}
            <div className="mt-4">
              <p className="mb-2 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
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
                  <span style={{ color: "#22C55E" }}>user@server</span>
                  <span style={{ color: "#6B7280" }}>:</span>
                  <span style={{ color: "#3B82F6" }}>~</span>
                  <span style={{ color: "#6B7280" }}>$ </span>
                  <span>ls -la</span>
                </div>
                <div style={{ color: "#9CA3AF" }}>total 32K</div>
                <div>
                  <span style={{ color: "#3B82F6" }}>drwxr-xr-x</span>{" "}
                  <span>4 user user 4096 Mar 5 12:00</span>{" "}
                  <span style={{ color: "#3B82F6" }}>.</span>
                </div>
                <div>
                  <span style={{ color: "#22C55E" }}>-rw-r--r--</span>{" "}
                  <span>1 user user 2048 Mar 5 11:30 config.toml</span>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section title={t("settings.terminalBg")}>
          <div className="space-y-3">
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
                        setTerminal((t) => ({ ...t, bgImagePath: file as string }));
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
                <span className="w-8 text-right text-[var(--font-size-sm)]">
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
                <span className="w-8 text-right text-[var(--font-size-sm)]">
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
        </Section>
        </>)}

        {activeTab === "about" && (<>
        <Section title={t("settings.dataPrivacy")}>
          <p className="text-[var(--font-size-sm)] leading-relaxed text-[var(--color-text-secondary)]">
            {t("settings.dataPrivacyDesc")}
          </p>
        </Section>

        <Section title={t("settings.about")}>
          <div className="space-y-2 text-[var(--font-size-sm)]">
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">{t("settings.version")}</span>
              <span>v{appVersion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">{t("settings.framework")}</span>
              <span>Tauri 2 + React</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">{t("settings.license")}</span>
              <span>MIT</span>
            </div>
          </div>
        </Section>
        </>)}
        </div>
      </div>
    </div>
  );
}
