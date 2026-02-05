import { linesToRaw } from "@/lib/env";
import type { EnvDocument, EnvFileRef, EnvLine, ProjectGroup } from "@/types";

export type ScanState = "idle" | "scanning" | "done" | "error";

export type AppState = {
  rootPath: string | null;
  scanState: ScanState;
  groups: ProjectGroup[];
  selectedGroupId: string | null;
  selectedFile: EnvFileRef | null;
  document: EnvDocument | null;
  originalLines: EnvLine[];
  rawText: string;
  activeTab: string;
  maskValues: boolean;
  createBackup: boolean;
  searchKey: string;
  statusMessage: string | null;
};

export type AppAction =
  | { type: "patch"; patch: Partial<AppState> }
  | { type: "scanStart" }
  | { type: "scanSuccess"; groups: ProjectGroup[] }
  | { type: "scanError"; message: string }
  | { type: "scanCanceled" }
  | { type: "openFileSuccess"; file: EnvFileRef; document: EnvDocument }
  | { type: "updateDocumentLines"; lines: EnvLine[] }
  | { type: "setRawText"; rawText: string; lines?: EnvLine[] };

export const initialState: AppState = {
  rootPath: null,
  scanState: "idle",
  groups: [],
  selectedGroupId: null,
  selectedFile: null,
  document: null,
  originalLines: [],
  rawText: "",
  activeTab: "table",
  maskValues: true,
  createBackup: false,
  searchKey: "",
  statusMessage: null,
};

export const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.patch };
    case "scanStart":
      return {
        ...state,
        scanState: "scanning",
        statusMessage: "Scanning for .env files...",
      };
    case "scanSuccess":
      return {
        ...state,
        groups: action.groups,
        selectedGroupId: action.groups[0]?.id ?? null,
        selectedFile: null,
        document: null,
        scanState: "done",
        statusMessage: `Found ${action.groups.length} project group(s).`,
      };
    case "scanError":
      return { ...state, scanState: "error", statusMessage: action.message };
    case "scanCanceled":
      return { ...state, scanState: "idle", statusMessage: "Scan canceled." };
    case "openFileSuccess":
      return {
        ...state,
        selectedFile: action.file,
        document: action.document,
        originalLines: action.document.lines,
        rawText: linesToRaw(action.document.lines),
        activeTab: "table",
        statusMessage: `Loaded ${action.file.fileName}`,
      };
    case "updateDocumentLines":
      if (!state.document) return state;
      return {
        ...state,
        document: { ...state.document, lines: action.lines },
        rawText: linesToRaw(action.lines),
      };
    case "setRawText":
      if (state.document && action.lines) {
        return {
          ...state,
          rawText: action.rawText,
          document: { ...state.document, lines: action.lines },
        };
      }
      return { ...state, rawText: action.rawText };
    default:
      return state;
  }
};
