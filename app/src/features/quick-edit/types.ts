import type {
  QuickEditSuggestedAction,
  QuickEditViewState,
  RemoteTextFile,
} from "@/types";
import type { QuickEditorStatus } from "../sftp/components/QuickEditor";

/**
 * Per-tab state inside the Quick Edit window.
 *
 * Mirrors the local state of the legacy QuickEditModal but lives inside a
 * zustand store so multiple tabs can coexist and survive cross-window events.
 */
export type QuickEditTab = {
  id: string;
  sessionId: string;
  hostId: string | null;
  hostName: string;
  remotePath: string;
  fileName: string;
  // editor + load state
  viewState: QuickEditViewState;
  remoteFile: RemoteTextFile | null;
  baselineContent: string;
  dirty: boolean;
  errorCode: string | null;
  // status bar
  editorStatus: QuickEditorStatus;
  statusMessage: string;
  // privileged save subdialog
  showPrivilegedSave: boolean;
  sudoPassword: string;
  createBackup: boolean;
  sudoPasswordError: boolean;
  // post-save suggestions
  suggestedActions: QuickEditSuggestedAction[];
  lastBackupPath: string | null;
  // session disconnect → readonly tab kept for review
  sessionDetached: boolean;
};
