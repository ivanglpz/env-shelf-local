import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import {
  diffKv,
  findDuplicateKeys,
  linesToRaw,
  listKvLines,
  parseRawToLines,
  removeKvKey,
  updateLinesWithKv,
} from "@/lib/env";
import {
  cancelScan,
  readEnvFile,
  scanEnvFiles,
  writeEnvFile,
} from "@/lib/tauri";
import type { EnvDocument, EnvFileRef, EnvLine, ProjectGroup } from "@/types";
import { open } from "@tauri-apps/api/dialog";
import * as React from "react";

const LOCAL_STORAGE_KEY = "envshelf:lastRoot";

type ScanState = "idle" | "scanning" | "done" | "error";

type AppState = {
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

type AppAction =
  | { type: "patch"; patch: Partial<AppState> }
  | { type: "scanStart" }
  | { type: "scanSuccess"; groups: ProjectGroup[] }
  | { type: "scanError"; message: string }
  | { type: "scanCanceled" }
  | { type: "openFileSuccess"; file: EnvFileRef; document: EnvDocument }
  | { type: "updateDocumentLines"; lines: EnvLine[] }
  | { type: "setRawText"; rawText: string; lines?: EnvLine[] };

const initialState: AppState = {
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
  createBackup: true,
  searchKey: "",
  statusMessage: null,
};

const appReducer = (state: AppState, action: AppAction): AppState => {
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

const App = () => {
  const [state, dispatch] = React.useReducer(appReducer, initialState);
  const {
    rootPath,
    scanState,
    groups,
    selectedGroupId,
    selectedFile,
    document,
    originalLines,
    rawText,
    activeTab,
    maskValues,
    createBackup,
    searchKey,
    statusMessage,
  } = state;

  React.useEffect(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    console.log(stored);

    if (stored) {
      dispatch({ type: "patch", patch: { rootPath: stored } });
    }
  }, []);

  const handleSelectFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      localStorage.setItem(LOCAL_STORAGE_KEY, selected);
      dispatch({ type: "patch", patch: { rootPath: selected } });
      await handleScan(selected);
    }
  };

  const handleScan = async (path: string) => {
    dispatch({ type: "scanStart" });
    try {
      const result = await scanEnvFiles(path);
      dispatch({ type: "scanSuccess", groups: result.groups });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scan failed";
      dispatch({ type: "scanError", message });
    }
  };

  const handleCancelScan = async () => {
    await cancelScan();
    dispatch({ type: "scanCanceled" });
  };

  const handleOpenFile = async (file: EnvFileRef) => {
    try {
      const doc = await readEnvFile(file.absolutePath);
      dispatch({ type: "openFileSuccess", file, document: doc });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Read failed";
      dispatch({ type: "patch", patch: { statusMessage: message } });
    }
  };

  const handleSelectGroup = async (group: ProjectGroup) => {
    dispatch({ type: "patch", patch: { selectedGroupId: group.id } });
    const firstFile = group.envFiles[0];
    if (firstFile) {
      await handleOpenFile(firstFile);
    }
  };

  const updateDocumentLines = (lines: EnvLine[]) => {
    if (!document) return;
    dispatch({ type: "updateDocumentLines", lines });
  };

  const handleRawChange = (value: string) => {
    if (!document) {
      dispatch({ type: "setRawText", rawText: value });
      return;
    }
    const parsed = parseRawToLines(value);
    dispatch({ type: "setRawText", rawText: value, lines: parsed });
  };

  const handleSave = async () => {
    if (!document || !selectedFile) return;
    const content = rawText;
    try {
      await writeEnvFile(selectedFile.absolutePath, content, { createBackup });
      dispatch({
        type: "patch",
        patch: { originalLines: document.lines, statusMessage: "File saved." },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed";
      dispatch({ type: "patch", patch: { statusMessage: message } });
    }
  };

  const handleRevert = async () => {
    if (!selectedFile) return;
    await handleOpenFile(selectedFile);
  };

  const kvLines = document ? listKvLines(document.lines) : [];
  const filteredKvLines = kvLines.filter((line) =>
    line.kind === "kv"
      ? line.key.toLowerCase().includes(searchKey.toLowerCase())
      : false,
  );
  const duplicates = document ? findDuplicateKeys(document.lines) : [];
  const diffItems = document ? diffKv(originalLines, document.lines) : [];

  const selectedGroup =
    groups.find((group) => group.id === selectedGroupId) ?? null;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold">Env-shelf</h1>
          <p className="text-sm text-muted-foreground">
            Local .env manager with safe edits.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {scanState === "scanning" ? (
            <Button variant="outline" onClick={handleCancelScan}>
              Cancel scan
            </Button>
          ) : (
            <Button onClick={handleSelectFolder}>Select folder</Button>
          )}
          {rootPath ? (
            <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
              {rootPath}
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex h-[calc(100vh-84px)] overflow-hidden">
        <aside className="w-72 border-r border-border p-4 overflow-x-hidden overflow-y-scroll">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Projects
            </h2>
            <Badge variant="secondary">{groups.length}</Badge>
          </div>
          <div className="space-y-2 overflow-auto pr-2">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => handleSelectGroup(group)}
                className={`w-full cursor-pointer rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  selectedGroupId === group.id
                    ? "border-primary/40 bg-muted"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{group.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.envFiles.length}
                  </span>
                </div>
                {/* <div className="mt-1 text-xs text-muted-foreground">{group.rootPath}</div> */}
              </button>
            ))}
          </div>
        </aside>

        <main className="flex-1 overflow-auto p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                {selectedGroup?.name ?? "No group selected"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {selectedGroup
                  ? selectedGroup.rootPath
                  : "Select a group to see its files."}
              </p>
            </div>
            <div className="text-sm text-muted-foreground">{statusMessage}</div>
          </div>

          <section className="mb-8 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Env files
              </h3>
              {scanState === "scanning" ? (
                <Badge variant="secondary">Scanning...</Badge>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-2">
              {selectedGroup?.envFiles.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => handleOpenFile(file)}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    selectedFile?.id === file.id
                      ? "border-primary/40 bg-muted"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{file.fileName}</span>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(file.size / 1024)} KB
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(file.modifiedAt).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Editor</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedFile
                    ? selectedFile.absolutePath
                    : "Select an env file to edit."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Toggle
                  pressed={createBackup}
                  onPressedChange={(value) =>
                    dispatch({
                      type: "patch",
                      patch: { createBackup: value },
                    })
                  }
                >
                  Create backup
                </Toggle>
                <Toggle
                  pressed={maskValues}
                  onPressedChange={(value) =>
                    dispatch({
                      type: "patch",
                      patch: { maskValues: value },
                    })
                  }
                >
                  Mask values
                </Toggle>
                <Button
                  variant="outline"
                  onClick={handleRevert}
                  disabled={!selectedFile}
                >
                  Revert
                </Button>
                <Button
                  variant="accent"
                  onClick={handleSave}
                  disabled={!selectedFile}
                >
                  Save
                </Button>
              </div>
            </div>

            {duplicates.length > 0 ? (
              <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Duplicate keys detected: {duplicates.join(", ")}
              </div>
            ) : null}

            <Tabs
              value={activeTab}
              onValueChange={(value) =>
                dispatch({ type: "patch", patch: { activeTab: value } })
              }
            >
              <TabsList>
                <TabsTrigger value="table">Table</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
                <TabsTrigger value="diff">Diff</TabsTrigger>
              </TabsList>

              <TabsContent value="table">
                <div className="mb-3 flex items-center justify-between">
                  <Input
                    placeholder="Search by key"
                    value={searchKey}
                    onChange={(event) =>
                      dispatch({
                        type: "patch",
                        patch: { searchKey: event.target.value },
                      })
                    }
                    className="max-w-sm"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!document) return;
                      updateDocumentLines(
                        updateLinesWithKv(document.lines, "NEW_KEY", "value"),
                      );
                    }}
                    disabled={!document}
                  >
                    Add variable
                  </Button>
                </div>

                <div className="space-y-2">
                  {filteredKvLines.map((line, index) =>
                    line.kind === "kv" ? (
                      <div
                        key={`${line.key}-${index}`}
                        className="grid grid-cols-[1fr_2fr_auto] items-center gap-3"
                      >
                        <Input
                          value={line.key}
                          onChange={(event) => {
                            if (!document) return;
                            const newKey = event.target.value;
                            if (newKey.trim() === "") {
                              dispatch({
                                type: "patch",
                                patch: {
                                  statusMessage: "Key cannot be empty.",
                                },
                              });
                              return;
                            }
                            const withoutOld = removeKvKey(
                              document.lines,
                              line.key,
                            );
                            updateDocumentLines(
                              updateLinesWithKv(withoutOld, newKey, line.value),
                            );
                          }}
                        />
                        <Input
                          type={maskValues ? "password" : "text"}
                          value={line.value}
                          onChange={(event) => {
                            if (!document) return;
                            updateDocumentLines(
                              updateLinesWithKv(
                                document.lines,
                                line.key,
                                event.target.value,
                              ),
                            );
                          }}
                        />
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (!document) return;
                            updateDocumentLines(
                              removeKvKey(document.lines, line.key),
                            );
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : null,
                  )}
                </div>
              </TabsContent>

              <TabsContent value="raw">
                <Textarea
                  className="min-h-[360px] font-mono text-xs"
                  value={rawText}
                  onChange={(event) => handleRawChange(event.target.value)}
                />
              </TabsContent>

              <TabsContent value="diff">
                <div className="space-y-2 text-sm">
                  {diffItems.length === 0 ? (
                    <div className="text-muted">No changes yet.</div>
                  ) : (
                    diffItems.map((item) => (
                      <div
                        key={`${item.key}-${item.change}`}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                      >
                        <div>
                          <div className="font-semibold">{item.key}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.change === "updated"
                              ? `${item.before} → ${item.after}`
                              : item.change === "added"
                                ? `Added: ${item.after}`
                                : `Removed: ${item.before}`}
                          </div>
                        </div>
                        <Badge
                          variant={
                            item.change === "removed" ? "warning" : "secondary"
                          }
                        >
                          {item.change}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </section>
        </main>
      </div>
    </div>
  );
};

export default App;
