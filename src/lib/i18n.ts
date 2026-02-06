export const messages = {
  en: {
    appTitle: "Env-shelf",
    appSubtitle: "Local .env manager with safe edits.",
    emptyStateDescription: "Choose a folder to find and edit your .env files.",

    settings: "Settings",
    settingsTitle: "Settings",
    settingsDescription: "Customize how Env-shelf looks and behaves.",

    theme: "Theme",
    light: "Light",
    dark: "Dark",

    language: "Language",
    english: "English",
    languageNote: "More languages coming soon.",

    privacy: "Privacy",
    showValues: "Show values",
    backup: "Backup on save",

    projectData: "Project data",
    forgetFolder: "Forget saved folder",
    forgetFolderHint: "Clear the remembered path and go back to the folder picker.",

    selectFolder: "Select folder",
    selectedFolderToast: "Folder selected",

    scanErrorToast: "Scan failed",
    scanSuccessToast: "Scan complete",
    scanEmptyToast: "No .env files found",
    scanSuccessDescription: "Found {count} project(s).",

    cancelScan: "Cancel scan",
    scanning: "Scanning...",

    projects: "Projects",
    noGroupSelected: "No group selected",
    envFiles: "Env files",
    variables: "Variables",

    revert: "Revert",
    save: "Save",

    duplicateKeys: "Duplicate keys detected: {keys}",

    table: "Table",
    raw: "Raw",
    diff: "Diff",

    searchByKey: "Search by key",
    addVariable: "Add variable",

    keyCannotBeEmpty: "Key cannot be empty.",

    noChangesYet: "No changes yet.",
    added: "Added: {after}",
    removed: "Removed: {before}",
    updated: "{before} -> {after}",

    fileSavedStatus: "File saved.",
    noChangesToSaveToast: "No changes to save",
    fileSavedToast: "File saved",
    fileSaveErrorToast: "Save failed",
    fileSavedDescription: "Added: {added}, Updated: {updated}, Removed: {removed}{backup}",
    fileSavedWithBackupSuffix: " (with backup).",
    fileSavedWithoutBackupSuffix: ".",

    diffAdded: "added",
    diffUpdated: "updated",
    diffRemoved: "removed",

    close: "Close",
  },
} as const;

export type Language = keyof typeof messages;
export type MessageKey = keyof typeof messages.en;

export const t = (
  language: Language,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string => {
  let value = messages[language][key] ?? messages.en[key];

  if (!vars) {
    return value;
  }

  for (const [name, raw] of Object.entries(vars)) {
    value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(raw));
  }

  return value;
};
