import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const LOCAL_STORAGE_LANGUAGE_KEY = "envshelf:language";

const resources = {
  en: {
    translation: {
      appTitle: "Env-shelf",
      appSubtitle: "Local .env manager with safe edits.",
      emptyStateDescription: "Choose a folder to find and edit your .env files.",

      settings: "Settings",
      settingsTitle: "Settings",
      settingsDescription: "Customize how Env-shelf looks and behaves.",

      language: "Language",
      english: "English",
      languageNote: "More languages coming soon.",

      privacy: "Privacy",
      showValues: "Show values",
      backup: "Backup on save",

      projectData: "Project data",
      forgetFolder: "Forget saved folder",
      forgetFolderHint:
        "Clear the remembered path and go back to the folder picker.",

      selectFolder: "Select folder",
      selectedFolderToast: "Folder selected",

      scanErrorToast: "Scan failed",
      scanSuccessToast: "Scan complete",
      scanEmptyToast: "No .env files found",
      scanSuccessDescription: "Found {{count}} project(s).",

      cancelScan: "Cancel scan",
      scanning: "Scanning...",

      projects: "Projects",
      noGroupSelected: "No group selected",
      envFiles: "Env files",
      variables: "Variables",

      revert: "Revert",
      save: "Save",

      duplicateKeys: "Duplicate keys detected: {{keys}}",

      table: "Table",
      raw: "Raw",
      diff: "Diff",

      searchByKey: "Search by key",
      addVariable: "Add variable",

      keyCannotBeEmpty: "Key cannot be empty.",

      noChangesYet: "No changes yet.",
      added: "Added: {{after}}",
      removed: "Removed: {{before}}",
      updated: "{{before}} -> {{after}}",

      fileSavedStatus: "File saved.",
      noChangesToSaveToast: "No changes to save",
      fileSavedToast: "File saved",
      fileSaveErrorToast: "Save failed",
      fileSavedDescription:
        "Added: {{added}}, Updated: {{updated}}, Removed: {{removed}}{{backup}}",
      fileSavedWithBackupSuffix: " (with backup).",
      fileSavedWithoutBackupSuffix: ".",

      diffAdded: "added",
      diffUpdated: "updated",
      diffRemoved: "removed",

      close: "Close",
    },
  },
} as const;

const initialLanguage = localStorage.getItem(LOCAL_STORAGE_LANGUAGE_KEY) ?? "en";

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export const supportedLanguages = ["en"] as const;
export type Language = (typeof supportedLanguages)[number];
export { LOCAL_STORAGE_LANGUAGE_KEY };
export default i18n;
