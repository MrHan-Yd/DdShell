const QUICK_EDIT_PICKER_DIR_STORAGE_KEY = "shell.quickEditPickerDir.v1";

type PickerDirRecord = {
  hostId?: string | null;
  sessionId: string;
  path: string;
  updatedAt: number;
};

function readRecords(): PickerDirRecord[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(QUICK_EDIT_PICKER_DIR_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PickerDirRecord => {
      return Boolean(
        item &&
          typeof item === "object" &&
          typeof item.sessionId === "string" &&
          typeof item.path === "string" &&
          typeof item.updatedAt === "number",
      );
    });
  } catch {
    return [];
  }
}

function writeRecords(records: PickerDirRecord[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(QUICK_EDIT_PICKER_DIR_STORAGE_KEY, JSON.stringify(records.slice(0, 50)));
  } catch {
    // ignore local storage failure
  }
}

export function recordQuickEditPickerDir(record: Omit<PickerDirRecord, "updatedAt">) {
  const next = [
    { ...record, updatedAt: Date.now() },
    ...readRecords().filter(
      (item) => !(item.sessionId === record.sessionId || (!!record.hostId && item.hostId === record.hostId)),
    ),
  ];
  writeRecords(next);
}

export function readQuickEditPickerDir(sessionId: string, hostId?: string | null): string | null {
  const records = readRecords();
  return (
    records.find((item) => item.sessionId === sessionId)?.path ??
    (hostId ? records.find((item) => item.hostId === hostId)?.path : null) ??
    null
  );
}

export function getRemoteDirPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `/${parts.join("/")}` : "/";
}
