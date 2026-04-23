import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/tauri";
import { interpolateWorkflowCommand } from "@/stores/workflows";
import type { WorkflowRecipe } from "@/types";

const RECENT_MACRO_STORAGE_KEY = "terminal.macro.recentIds";

type SessionState = "connected" | "disconnected" | "failed";

export type MacroRunState = "idle" | "running" | "cancelling" | "failed" | "completed" | "cancelled";

export interface ActiveMacroRun {
  runId: string;
  recipeId: string;
  sessionId: string;
  title: string;
  stepIndex: number;
  totalSteps: number;
  state: MacroRunState;
  startedAt: number;
  lastError?: string;
}

export interface MacroOutputFilter {
  sessionId: string;
  runId: string;
  stepId: string;
  displayCommand: string;
}

interface ParsedParam {
  key: string;
  defaultValue: string;
  required: boolean;
}

interface ParsedStep {
  id: string;
  title: string;
  command: string;
  renderedCommand: string;
}

interface ActiveRunInternal {
  active: ActiveMacroRun;
  steps: ParsedStep[];
}

interface StartMacroRunOptions {
  recipe: WorkflowRecipe;
  sessionId: string;
  sessionState: SessionState;
  runtimeParams?: Record<string, string>;
  confirmDangerousCommands?: (commands: string[]) => Promise<boolean>;
}

function safeParseArray<T>(json: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function parseParams(paramsJson: string): ParsedParam[] {
  const params = safeParseArray<Record<string, unknown>>(paramsJson, []);
  return params.map((param) => {
    const key = typeof param.key === "string" ? param.key.trim() : "";
    const rawDefault = param.defaultValue ?? param.default_value;
    const defaultValue = typeof rawDefault === "string" ? rawDefault : "";
    return {
      key,
      defaultValue,
      required: param.required === true,
    };
  });
}

function parseSteps(stepsJson: string, values: Record<string, string>): ParsedStep[] {
  const steps = safeParseArray<Record<string, unknown>>(stepsJson, []);
  return steps
    .map((step) => {
      const command = typeof step.command === "string" ? step.command.trim() : "";
      if (!command) return null;
      const title = typeof step.title === "string" ? step.title.trim() : "";
      const id = typeof step.id === "string" && step.id.trim().length > 0 ? step.id : crypto.randomUUID();
      return {
        id,
        title,
        command,
        renderedCommand: interpolateWorkflowCommand(command, values),
      };
    })
    .filter((step): step is ParsedStep => Boolean(step));
}

function readRecentMacroIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_MACRO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 3);
  } catch {
    return [];
  }
}

function writeRecentMacroIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_MACRO_STORAGE_KEY, JSON.stringify(ids.slice(0, 3)));
  } catch {
    // ignore local storage failure
  }
}

const TOKEN_REGEX = /__MACRO_EC__:([^:\s]+):([^:\s]+):(\d+)/;

function buildMacroHiddenSuffix(runId: string, stepId: string): string {
  return `; printf '__MACRO_EC__:${runId}:${stepId}:%s\\n' "$?"`;
}

function buildEchoControlCommand(enable: boolean): string {
  return enable ? "stty echo\r" : "stty -echo\r";
}

async function writeText(sessionId: string, text: string): Promise<void> {
  const encoder = new TextEncoder();
  await api.sessionWrite(sessionId, Array.from(encoder.encode(text)));
}

function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

function logMacroEvent(event: string, payload: Record<string, string | number | undefined>) {
  console.info("[macro-runner]", event, payload);
}

export function useMacroRunner() {
  const [activeMacroRun, setActiveMacroRun] = useState<ActiveMacroRun | null>(null);
  const [macroOutputFilter, setMacroOutputFilter] = useState<MacroOutputFilter | null>(null);
  const [recentMacroIds, setRecentMacroIds] = useState<string[]>(() => readRecentMacroIds());
  const [lastRunAtMap, setLastRunAtMap] = useState<Record<string, number>>({});
  const [hasFailedBadge, setHasFailedBadge] = useState(false);

  const activeRunRef = useRef<ActiveRunInternal | null>(null);
  const outputBufferRef = useRef("");
  const decoderRef = useRef(new TextDecoder());
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const echoDisabledSessionRef = useRef<string | null>(null);
  const inlineEchoRestoreRunRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (cancelTimerRef.current) {
        clearTimeout(cancelTimerRef.current);
      }
    };
  }, []);

  const resetRun = useCallback((nextState: MacroRunState, lastError?: string) => {
    const current = activeRunRef.current;
    if (!current) return;

    if (cancelTimerRef.current) {
      clearTimeout(cancelTimerRef.current);
      cancelTimerRef.current = null;
    }

    const next = {
      ...current.active,
      state: nextState,
      lastError,
    };
    setActiveMacroRun(next);

    if (nextState === "failed") {
      setHasFailedBadge(true);
    }

    logMacroEvent("finished", {
      runId: next.runId,
      recipeId: next.recipeId,
      sessionId: next.sessionId,
      state: next.state,
      stepIndex: next.stepIndex,
      totalSteps: next.totalSteps,
      error: next.lastError,
    });

    setLastRunAtMap((prev) => ({ ...prev, [next.recipeId]: Date.now() }));
    setRecentMacroIds((prev) => {
      const nextIds = [next.recipeId, ...prev.filter((id) => id !== next.recipeId)].slice(0, 3);
      writeRecentMacroIds(nextIds);
      return nextIds;
    });

    activeRunRef.current = null;
    outputBufferRef.current = "";
    setMacroOutputFilter(null);

    if (echoDisabledSessionRef.current === next.sessionId) {
      echoDisabledSessionRef.current = null;
      const shouldSkipExplicitRestore = inlineEchoRestoreRunRef.current === next.runId && nextState !== "cancelled";
      inlineEchoRestoreRunRef.current = null;
      if (!shouldSkipExplicitRestore) {
        void writeText(next.sessionId, buildEchoControlCommand(true)).catch(() => {
          // ignore echo restore failure on cleanup
        });
      }
    } else {
      inlineEchoRestoreRunRef.current = null;
    }
  }, []);

  const sendStepCommand = useCallback(async (run: ActiveRunInternal, stepIndex: number) => {
    const step = run.steps[stepIndex];
    if (!step) return;

    const normalized = step.renderedCommand.replace(/\r?\n/g, "\r");
    const hiddenSuffix = buildMacroHiddenSuffix(run.active.runId, step.id);
    const isLastStep = stepIndex >= run.steps.length - 1;
    setMacroOutputFilter({
      sessionId: run.active.sessionId,
      runId: run.active.runId,
      stepId: step.id,
      displayCommand: step.renderedCommand,
    });
    inlineEchoRestoreRunRef.current = isLastStep ? run.active.runId : null;
    const wrapped = `${normalized}${hiddenSuffix}${isLastStep ? "; stty echo" : ""}\r`;
    await writeText(run.active.sessionId, wrapped);
  }, []);

  const startRun = useCallback(async (options: StartMacroRunOptions): Promise<string | null> => {
    if (activeRunRef.current && ["running", "cancelling"].includes(activeRunRef.current.active.state)) {
      return "macro.runAlreadyRunning";
    }

    if (options.sessionState !== "connected") {
      return "macro.sessionDisconnected";
    }

    const params = parseParams(options.recipe.paramsJson);
    const runtimeParams = options.runtimeParams ?? {};
    const values: Record<string, string> = {};
    for (const param of params) {
      if (!param.key) continue;
      const runtimeValue = runtimeParams[param.key];
      const effective = runtimeValue ?? param.defaultValue;
      values[param.key] = effective;
      if (param.required && !effective.trim()) {
        return `macro.requiredParamMissing:${param.key}`;
      }
    }

    const steps = parseSteps(options.recipe.stepsJson, values);
    if (steps.length === 0) {
      return "macro.noExecutableSteps";
    }

    if (options.confirmDangerousCommands) {
      const ok = await options.confirmDangerousCommands(steps.map((step) => step.renderedCommand));
      if (!ok) return "macro.cancelled";
    }

    const runId = crypto.randomUUID();
    const active: ActiveMacroRun = {
      runId,
      recipeId: options.recipe.id,
      sessionId: options.sessionId,
      title: options.recipe.title,
      stepIndex: 0,
      totalSteps: steps.length,
      state: "running",
      startedAt: Date.now(),
    };

    const internal: ActiveRunInternal = { active, steps };
    activeRunRef.current = internal;
    setActiveMacroRun(active);
    outputBufferRef.current = "";
    decoderRef.current = new TextDecoder();
    inlineEchoRestoreRunRef.current = null;

    logMacroEvent("started", {
      runId: active.runId,
      recipeId: active.recipeId,
      sessionId: active.sessionId,
      totalSteps: active.totalSteps,
      runtimeParamCount: Object.keys(runtimeParams).length,
    });

    try {
      await writeText(active.sessionId, buildEchoControlCommand(false));
      echoDisabledSessionRef.current = active.sessionId;
      await sendStepCommand(internal, 0);
      return null;
    } catch (error) {
      resetRun("failed", error instanceof Error ? error.message : String(error));
      return "macro.startFailed";
    }
  }, [resetRun, sendStepCommand]);

  const stopRun = useCallback(async (): Promise<void> => {
    const current = activeRunRef.current;
    if (!current || current.active.state !== "running") return;

    const cancellingState: ActiveMacroRun = { ...current.active, state: "cancelling" };
    current.active = cancellingState;
    setActiveMacroRun(cancellingState);
    logMacroEvent("cancelling", {
      runId: cancellingState.runId,
      recipeId: cancellingState.recipeId,
      sessionId: cancellingState.sessionId,
      stepIndex: cancellingState.stepIndex,
    });

    try {
      await api.sessionWrite(current.active.sessionId, [3]);
    } catch {
      // ignore ctrl+c send failure and still cancel locally
    }

    cancelTimerRef.current = setTimeout(() => {
      const run = activeRunRef.current;
      if (!run || run.active.state !== "cancelling") return;
      resetRun("cancelled");
    }, 1200);
  }, [resetRun]);

  const handleSessionOutput = useCallback(async (sessionId: string, data: number[]) => {
    const current = activeRunRef.current;
    if (!current || current.active.sessionId !== sessionId) return;
    if (current.active.state !== "running" && current.active.state !== "cancelling") return;

    const chunk = decoderRef.current.decode(new Uint8Array(data), { stream: true });
    outputBufferRef.current += chunk;

    const lines = outputBufferRef.current.split(/\r?\n/);
    outputBufferRef.current = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = stripAnsi(rawLine).trim();
      const match = TOKEN_REGEX.exec(line);
      if (!match) continue;

      const [, runId, stepId, codeStr] = match;
      if (runId !== current.active.runId) continue;

      const step = current.steps[current.active.stepIndex];
      if (!step || step.id !== stepId) continue;

      const code = Number(codeStr);

      if (current.active.state === "cancelling") {
        resetRun("cancelled");
        return;
      }

      if (code !== 0) {
        resetRun("failed", `exit ${code}`);
        return;
      }

      if (current.active.stepIndex >= current.steps.length - 1) {
        resetRun("completed");
        return;
      }

      const nextStepIndex = current.active.stepIndex + 1;
      const nextActive = {
        ...current.active,
        stepIndex: nextStepIndex,
      };
      current.active = nextActive;
      setActiveMacroRun(nextActive);

      setTimeout(() => {
        const latest = activeRunRef.current;
        if (!latest || latest.active.runId !== current.active.runId) return;
        void sendStepCommand(latest, nextStepIndex).catch((error) => {
          resetRun("failed", error instanceof Error ? error.message : String(error));
        });
      }, 80);
      return;
    }
  }, [resetRun, sendStepCommand]);

  const handleSessionStateChanged = useCallback((sessionId: string, state: SessionState) => {
    const current = activeRunRef.current;
    if (!current || current.active.sessionId !== sessionId) return;
    if (state === "connected") return;

    if (current.active.state === "cancelling") {
      resetRun("cancelled");
      return;
    }

    resetRun("failed", "session disconnected");
  }, [resetRun]);

  const clearFailedBadge = useCallback(() => {
    setHasFailedBadge(false);
  }, []);

  const progressText = useMemo(() => {
    if (!activeMacroRun || activeMacroRun.state === "idle") return null;
    if (activeMacroRun.state === "running" || activeMacroRun.state === "cancelling") {
      return `${activeMacroRun.stepIndex + 1}/${activeMacroRun.totalSteps}`;
    }
    return null;
  }, [activeMacroRun]);

  return {
    activeMacroRun,
    macroOutputFilter,
    recentMacroIds,
    lastRunAtMap,
    hasFailedBadge,
    progressText,
    startRun,
    stopRun,
    handleSessionOutput,
    handleSessionStateChanged,
    clearFailedBadge,
  };
}
