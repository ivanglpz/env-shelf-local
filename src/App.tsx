import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  diffKv,
  findDuplicateKeys,
  listKvLines,
  parseRawToLines,
  removeKvKey,
  updateLinesWithKv,
} from "@/lib/env";
import { supportedLanguages, type Language } from "@/lib/i18n";
import {
  cancelScan,
  readEnvFile,
  scanEnvFiles,
  writeEnvFile,
} from "@/lib/tauri";
import { appReducer, initialState } from "@/state/reducer";
import type { EnvFileRef, EnvLine, ProjectGroup } from "@/types";
import { open } from "@tauri-apps/api/dialog";
import { FolderOpen, Plus, Save, Settings, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const LOCAL_STORAGE_KEY = "envshelf:lastRoot";
const LOCAL_STORAGE_LANGUAGE_KEY = "envshelf:language";

const App = () => {
  const { t: tx, i18n } = useTranslation();
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

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const currentLanguage = i18n.resolvedLanguage ?? i18n.language;
  const language = supportedLanguages.includes(currentLanguage as Language)
    ? (currentLanguage as Language)
    : "en";

  const getEnvFileButtonClassName = (isSelected: boolean) =>
    isSelected
      ? "cursor-pointer rounded-md bg-neutral-700 border px-3 py-2 text-left text-sm transition-colors border-primary/40 bg-muted"
      : "cursor-pointer rounded-md border px-3 py-2 text-left text-sm transition-colors border-border hover:border-primary/40";

  React.useEffect(() => {
    const storedRoot = localStorage.getItem(LOCAL_STORAGE_KEY);
    const storedLanguage = localStorage.getItem(LOCAL_STORAGE_LANGUAGE_KEY);
    if (
      storedLanguage &&
      supportedLanguages.includes(storedLanguage as Language)
    ) {
      void i18n.changeLanguage(storedLanguage);
    }

    if (storedRoot) {
      dispatch({ type: "patch", patch: { rootPath: storedRoot } });
      void handleScan(storedRoot);
    }
  }, [i18n]);

  const handleSelectFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      localStorage.setItem(LOCAL_STORAGE_KEY, selected);
      dispatch({ type: "patch", patch: { rootPath: selected } });
      toast.message(tx("selectedFolderToast"), { description: selected });
      await handleScan(selected);
    }
  };

  const handleScan = async (path: string) => {
    dispatch({ type: "scanStart" });
    try {
      const result = await scanEnvFiles(path);
      dispatch({ type: "scanSuccess", groups: result.groups });
      if (result.groups.length === 0) {
        toast.warning(tx("scanEmptyToast"));
      } else {
        toast.success(tx("scanSuccessToast"), {
          description: tx("scanSuccessDescription", {
            count: result.groups.length,
          }),
        });
      }
      const firstGroup = result.groups[0];
      if (firstGroup) {
        await handleSelectGroup(firstGroup);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : tx("scanErrorToast");
      dispatch({ type: "scanError", message });
      toast.error(tx("scanErrorToast"), { description: message });
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
    const pendingChanges = diffKv(originalLines, document.lines);
    const added = pendingChanges.filter(
      (item) => item.change === "added",
    ).length;
    const updated = pendingChanges.filter(
      (item) => item.change === "updated",
    ).length;
    const removed = pendingChanges.filter(
      (item) => item.change === "removed",
    ).length;
    try {
      await writeEnvFile(selectedFile.absolutePath, content, { createBackup });
      dispatch({
        type: "patch",
        patch: {
          originalLines: document.lines,
          statusMessage: tx("fileSavedStatus"),
        },
      });
      if (pendingChanges.length === 0) {
        toast.message(tx("noChangesToSaveToast"));
      } else {
        toast.success(tx("fileSavedToast"), {
          description: tx("fileSavedDescription", {
            added,
            updated,
            removed,
            backup: createBackup
              ? tx("fileSavedWithBackupSuffix")
              : tx("fileSavedWithoutBackupSuffix"),
          }),
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : tx("fileSaveErrorToast");
      dispatch({ type: "patch", patch: { statusMessage: message } });
      toast.error(tx("fileSaveErrorToast"), { description: message });
    }
  };

  const handleRevert = async () => {
    if (!selectedFile) return;
    await handleOpenFile(selectedFile);
  };

  const handleForgetSavedFolder = () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    dispatch({
      type: "patch",
      patch: {
        rootPath: null,
        groups: [],
        selectedGroupId: null,
        selectedFile: null,
        document: null,
        originalLines: [],
        rawText: "",
        searchKey: "",
        statusMessage: null,
      },
    });
    setSettingsOpen(false);
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

  const settingsDialog = (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          aria-label={tx("settings")}
          title={tx("settings")}
          className="h-9 w-9 p-0"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx("settingsTitle")}</DialogTitle>
          <DialogDescription>{tx("settingsDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">{tx("language")}</h4>
            <Select
              value={language}
              onValueChange={(value) => {
                localStorage.setItem(LOCAL_STORAGE_LANGUAGE_KEY, value);
                void i18n.changeLanguage(value);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{tx("english")}</SelectItem>
                <SelectItem value="es">{tx("spanish")}</SelectItem>
                <SelectItem value="pt-BR">{tx("portugueseBrazil")}</SelectItem>
                <SelectItem value="ja">{tx("japanese")}</SelectItem>
                <SelectItem value="de">{tx("german")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {tx("languageNote")}
            </p>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold">{tx("privacy")}</h4>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-sm">{tx("showValues")}</span>
              <Switch
                checked={!maskValues}
                onCheckedChange={(value) =>
                  dispatch({ type: "patch", patch: { maskValues: !value } })
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-sm">{tx("backup")}</span>
              <Switch
                checked={createBackup}
                onCheckedChange={(value) =>
                  dispatch({ type: "patch", patch: { createBackup: value } })
                }
              />
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold">{tx("projectData")}</h4>
            <p className="text-xs text-muted-foreground">
              {tx("forgetFolderHint")}
            </p>
            <Button variant="outline" onClick={handleForgetSavedFolder}>
              {tx("forgetFolder")}
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (!rootPath) {
    return (
      <>
        <div className="relative min-h-screen bg-background text-foreground">
          <div className="absolute right-6 top-6">{settingsDialog}</div>
          <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
            <h1 className="text-4xl font-semibold">{tx("appTitle")}</h1>
            <p className="mt-3 text-base text-muted-foreground">
              {tx("emptyStateDescription")}
            </p>
            <div className="mt-6">
              <Button
                onClick={handleSelectFolder}
                aria-label={tx("selectFolder")}
                title={tx("selectFolder")}
                className="h-9 w-9 p-0"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        <Toaster richColors closeButton position="top-right" />
      </>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-background text-foreground overflow-hidden">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h1 className="text-2xl font-semibold">{tx("appTitle")}</h1>
            <p className="text-sm text-muted-foreground">{tx("appSubtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            {scanState === "scanning" ? (
              <Button variant="outline" onClick={handleCancelScan}>
                {tx("cancelScan")}
              </Button>
            ) : (
              <Button
                onClick={handleSelectFolder}
                aria-label={tx("selectFolder")}
                title={tx("selectFolder")}
                className="h-9 w-9 p-0"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            )}
            {settingsDialog}
            {rootPath ? (
              <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                {rootPath}
              </div>
            ) : null}
          </div>
        </header>

        <div className="flex h-[calc(100vh-84px)] overflow-hidden">
          <aside className="w-72 border-r border-border p-4 overflow-x-hidden overflow-y-auto">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {tx("projects")}
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
                </button>
              ))}
            </div>
          </aside>

          <main className="flex-1 overflow-auto p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {selectedGroup?.name ?? tx("noGroupSelected")}
                </h2>
              </div>
              <div className="text-sm text-muted-foreground">
                {statusMessage}
              </div>
            </div>

            <section className="mb-8 rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {tx("envFiles")}
                </h3>
                {scanState === "scanning" ? (
                  <Badge variant="secondary">{tx("scanning")}</Badge>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {selectedGroup?.envFiles.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => handleOpenFile(file)}
                    className={getEnvFileButtonClassName(
                      selectedFile?.id === file.id,
                    )}
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
                  <h3 className="text-lg font-semibold">{tx("variables")}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <section className="flex flex-row items-center gap-2">
                    <p>{tx("showValues")}</p>
                    <Switch
                      checked={!maskValues}
                      onCheckedChange={(value) => {
                        dispatch({
                          type: "patch",
                          patch: { maskValues: !value },
                        });
                      }}
                    ></Switch>
                  </section>
                  <section className="flex flex-row items-center gap-2">
                    <p>{tx("backup")}</p>
                    <Switch
                      checked={createBackup}
                      onCheckedChange={(value) => {
                        dispatch({
                          type: "patch",
                          patch: { createBackup: value },
                        });
                      }}
                    ></Switch>
                  </section>

                  <Button
                    variant="outline"
                    onClick={handleRevert}
                    disabled={!selectedFile}
                  >
                    {tx("revert")}
                  </Button>
                  <Button
                    variant="accent"
                    onClick={handleSave}
                    disabled={!selectedFile}
                    className="inline-flex items-center gap-2 bg-green-500 text-black"
                  >
                    <Save className="h-4 w-4" />
                    {tx("save")}
                  </Button>
                </div>
              </div>

              {duplicates.length > 0 ? (
                <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {tx("duplicateKeys", { keys: duplicates.join(", ") })}
                </div>
              ) : null}

              <Tabs
                value={activeTab}
                onValueChange={(value) =>
                  dispatch({ type: "patch", patch: { activeTab: value } })
                }
              >
                <TabsList>
                  <TabsTrigger value="table">{tx("table")}</TabsTrigger>
                  <TabsTrigger value="raw">{tx("raw")}</TabsTrigger>
                  <TabsTrigger value="diff">{tx("diff")}</TabsTrigger>
                </TabsList>

                <TabsContent value="table">
                  <div className="mb-3 flex items-center justify-between">
                    <Input
                      placeholder={tx("searchByKey")}
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
                      className="inline-flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      {tx("addVariable")}
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {filteredKvLines.map((line, index) =>
                      line.kind === "kv" ? (
                        <div
                          key={index}
                          className="grid grid-cols-[1fr_2fr_auto] items-center gap-3"
                        >
                          <Input
                            value={line.key}
                            onChange={(event) => {
                              if (!document) return;
                              const rawKey = event.target.value;
                              if (rawKey.trim() === "") {
                                dispatch({
                                  type: "patch",
                                  patch: {
                                    statusMessage: tx("keyCannotBeEmpty"),
                                  },
                                });
                                return;
                              }
                              const newKey = rawKey
                                .toUpperCase()
                                .replace(/\s+/g, "_");
                              updateDocumentLines(
                                document.lines.map((currentLine) =>
                                  currentLine === line
                                    ? {
                                        ...currentLine,
                                        key: newKey,
                                        raw: undefined,
                                      }
                                    : currentLine,
                                ),
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
                            aria-label={`Remove ${line.key}`}
                            title={`Remove ${line.key}`}
                            className="h-9 w-9 p-0"
                            onClick={() => {
                              if (!document) return;
                              updateDocumentLines(
                                removeKvKey(document.lines, line.key),
                              );
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
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
                      <div className="text-muted">{tx("noChangesYet")}</div>
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
                                ? tx("updated", {
                                    before: item.before ?? "",
                                    after: item.after ?? "",
                                  })
                                : item.change === "added"
                                  ? tx("added", { after: item.after ?? "" })
                                  : tx("removed", {
                                      before: item.before ?? "",
                                    })}
                            </div>
                          </div>
                          <Badge
                            variant={
                              item.change === "removed"
                                ? "warning"
                                : "secondary"
                            }
                          >
                            {item.change === "removed"
                              ? tx("diffRemoved")
                              : item.change === "updated"
                                ? tx("diffUpdated")
                                : tx("diffAdded")}
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
      <Toaster richColors closeButton position="top-right" />
    </>
  );
};

export default App;
