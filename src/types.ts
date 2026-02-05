export type EnvFileRef = {
  id: string;
  absolutePath: string;
  fileName: string;
  folderPath: string;
  size: number;
  modifiedAt: number;
};

export type ProjectGroup = {
  id: string;
  name: string;
  rootPath: string;
  envFiles: EnvFileRef[];
};

export type EnvLine =
  | { kind: "blank" }
  | { kind: "comment"; raw: string }
  | { kind: "kv"; key: string; value: string; hasExport: boolean; raw?: string }
  | { kind: "unknown"; raw: string };

export type EnvDocument = {
  file: EnvFileRef;
  lines: EnvLine[];
};

export type ScanResult = {
  rootPath: string;
  groups: ProjectGroup[];
};

export type WriteOptions = {
  createBackup: boolean;
};

export type DiffItem = {
  key: string;
  change: "added" | "updated" | "removed";
  before?: string;
  after?: string;
};
